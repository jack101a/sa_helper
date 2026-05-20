# 05a — Capacity Planning & Oracle VPS Deployment

> Part of [05-opus-final-architecture-plan.md](./05-opus-final-architecture-plan.md)

---

## Target Load Profile

| Metric | Current | Target (Launch) | Target (Max) |
|--------|---------|-----------------|--------------|
| Active users | ~5 | 50 | 100 |
| Concurrent captcha solves | ~2 | 20 | 40 |
| Concurrent MCQ solves | ~1 | 2-4 | 8 |
| Requests/min (captcha) | ~10 | 200 | 400 |
| Requests/min (MCQ) | ~2 | 20 | 40 |

## Oracle Cloud Free Tier (ARM A1)

**Available**: 4 OCPU, 24 GB RAM, 200 GB block storage

### Resource Allocation Plan

```
┌─────────────────────────────────────────────────────────┐
│                   Oracle VPS (24 GB)                     │
├───────────────┬──────────┬──────────────────────────────┤
│  Component    │   RAM    │  Notes                       │
├───────────────┼──────────┼──────────────────────────────┤
│  FastAPI      │  2 GB    │  2 uvicorn workers           │
│  (sa-helper)  │          │  + 4 solver queue workers    │
│               │          │  + 2 OCR threads             │
├───────────────┼──────────┼──────────────────────────────┤
│  ONNX Runtime │  1 GB    │  Model loaded per worker     │
│               │          │  ~200MB per model instance   │
├───────────────┼──────────┼──────────────────────────────┤
│  Tesseract    │  500 MB  │  eng+hin language data       │
│  (OCR)        │          │  2 concurrent processes      │
├───────────────┼──────────┼──────────────────────────────┤
│  Telegram Bot │  300 MB  │  Separate container          │
├───────────────┼──────────┼──────────────────────────────┤
│  SQLite/DB    │  200 MB  │  WAL mode, shared volume     │
├───────────────┼──────────┼──────────────────────────────┤
│  OS + Docker  │  2 GB    │  Ubuntu + Docker overhead    │
├───────────────┼──────────┼──────────────────────────────┤
│  BUFFER       │  ~18 GB  │  Available for spikes        │
└───────────────┴──────────┴──────────────────────────────┘
```

**Verdict**: 24 GB is **more than sufficient** for 100 users. The bottleneck is CPU (OCR + ONNX), not RAM.

### CPU Bottleneck Analysis

| Operation | CPU Time (per request) | Concurrency |
|-----------|----------------------|-------------|
| ONNX captcha solve | 50-200ms | Queue: 4 workers |
| Tesseract OCR (1 image) | 200-800ms | Semaphore: 2 |
| MCQ solve (5 images OCR) | 1-4s total | Thread pool: 5 |
| LLM fallback (external) | 2-10s (network) | httpx async |

**For 20 concurrent captcha solves**: 4 queue workers, each taking ~150ms = **~53 solves/sec** → ✅ handles 20 concurrent easily.

**For 4 concurrent MCQ solves**: Each takes ~2-4s due to OCR. With 2 OCR threads + 5 thread pool = **~2-3 concurrent MCQ solves saturate OCR**. 

### MCQ Concurrency Fix

**Current**: `ocr_concurrency=2` (semaphore in ExamService) is too low for 4 concurrent MCQ solves.

**Change**: 
```yaml
# config.yaml
exam:
  ocr_concurrency: 4    # was 2
```

And in `docker-compose.yml`:
```yaml
environment:
  - EXAM_OCR_CONCURRENCY=4
  - QUEUE_WORKERS=6      # was 4
```

This saturates 4 OCPU but handles the target load.

---

## Docker Compose — Production (Oracle VPS)

```yaml
# docker-compose.prod.yml — Oracle VPS deployment
services:
  sa-helper:
    image: ghcr.io/jack101a/sa-helper:latest
    container_name: sa-helper
    restart: unless-stopped
    init: true
    stop_grace_period: 60s
    ports:
      - "8088:8080"
    deploy:
      resources:
        limits:
          cpus: "3.0"
          memory: 4G
        reservations:
          memory: 2G
    environment:
      - APP_ENV=production
      - DEBUG=false
      - PORT=8080
      - AUTH_HASH_SALT=${AUTH_HASH_SALT}
      - ADMIN_TOKEN=${ADMIN_TOKEN}
      - ADMIN_USERNAME=${ADMIN_USERNAME:-admin}
      - ADMIN_PASSWORD=${ADMIN_PASSWORD}
      - LITELLM_ENDPOINT=${LITELLM_ENDPOINT:-}
      - LITELLM_API_KEY=${LITELLM_API_KEY:-}
      - QUEUE_WORKERS=6
      - EXAM_OCR_CONCURRENCY=4
      - CALLMEBOT_PHONE=${CALLMEBOT_PHONE:-}
      - CALLMEBOT_APIKEY=${CALLMEBOT_APIKEY:-}
      - TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN:-}
      - TELEGRAM_BOT_ENABLED=${TELEGRAM_BOT_ENABLED:-false}
      - SQLITE_PATH=/app/backend/logs/app.db
      - CONFIG_PATH=/app/backend/config/config.yaml
      - ONNX_PATH=/app/data/models/model.onnx
    volumes:
      - sa_helper_logs:/app/backend/logs
      - sa_helper_data:/app/data
      - sa_helper_config:/app/backend/config
    healthcheck:
      test: ["CMD", "curl", "-sf", "http://localhost:8080/health"]
      interval: 30s
      timeout: 10s
      start_period: 15s
      retries: 3

  telegram-bot:
    image: ghcr.io/jack101a/sa-helper:latest
    container_name: sa-helper-telegram-bot
    restart: unless-stopped
    init: true
    depends_on:
      sa-helper:
        condition: service_healthy
    command: ["python", "-m", "app.services.telegram_bot"]
    deploy:
      resources:
        limits:
          cpus: "0.5"
          memory: 512M
    environment:
      - APP_ENV=production
      - DEBUG=false
      - AUTH_HASH_SALT=${AUTH_HASH_SALT}
      - ADMIN_TOKEN=${ADMIN_TOKEN}
      - ADMIN_USERNAME=${ADMIN_USERNAME:-admin}
      - ADMIN_PASSWORD=${ADMIN_PASSWORD}
      - TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN}
      - TELEGRAM_BOT_ENABLED=true
      - TELEGRAM_BOT_WAIT_FOR_TOKEN=true
      - SQLITE_PATH=/app/backend/logs/app.db
      - CONFIG_PATH=/app/backend/config/config.yaml
    volumes:
      - sa_helper_logs:/app/backend/logs
      - sa_helper_data:/app/data
      - sa_helper_config:/app/backend/config

volumes:
  sa_helper_logs:
  sa_helper_data:
  sa_helper_config:
```

---

## Future Scaling (100+ Users)

When load exceeds single VPS capacity:

### Option A: Second Oracle VPS (Cheapest)

```
┌───────────────────┐     ┌───────────────────┐
│   VPS 1 (API)     │     │   VPS 2 (Workers)  │
│  FastAPI + Admin   │────▶│  OCR + ONNX       │
│  Telegram Bot     │     │  MCQ Solver        │
│  SQLite (primary) │     │  Redis Queue       │
└───────────────────┘     └───────────────────┘
```

- VPS 1 handles API + Telegram + admin dashboard
- VPS 2 runs OCR/ONNX workers connected via Redis queue
- Requires Redis (can run on either VPS)

### Option B: Vertical Scaling (Oracle Paid)

- Upgrade to 8 OCPU / 48 GB
- Increase `QUEUE_WORKERS=12`, `EXAM_OCR_CONCURRENCY=8`
- Add `--workers 4` to uvicorn
- This handles ~200 concurrent users without architectural changes

### Option C: Cloudflare Tunnel (No Public IP Needed)

```bash
# On Oracle VPS
cloudflared tunnel --url http://localhost:8088
```

This eliminates the need for a public IP and provides DDoS protection for free.

---

## Monitoring (Minimal)

Since this is a small deployment, use lightweight monitoring:

1. **Docker logs**: `docker compose logs -f --tail=100`
2. **Health endpoint**: `/health` already exists
3. **WhatsApp alerts**: Already implemented via `AlertService` — notifies on server start
4. **Disk space check**: Add to cron
   ```bash
   # /etc/cron.d/sa-helper-monitor
   */30 * * * * root df -h / | tail -1 | awk '{if ($5+0 > 80) print "DISK WARNING: "$5}' | logger
   ```
