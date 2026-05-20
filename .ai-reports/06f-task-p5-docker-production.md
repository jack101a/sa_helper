# Task P5 — Docker Production & Deployment

> **Tasks**: T20, T21, T22  
> **Priority**: P5  
> **Depends on**: None  
> **Estimated changes**: ~80 lines modified across 3 files

---

## Files to Read First

1. `docker-entrypoint.sh` — full file (22 lines)
2. `Dockerfile` — full file (58 lines)
3. `docker-compose.yml` — full file (69 lines)
4. `backend/alembic.ini` — lines 1-10 (script_location)

---

## T20: Harden docker-entrypoint.sh

### Goal

Add Alembic migration, directory permission fixes, and better error handling.

**File**: `docker-entrypoint.sh`  
**Replace the ENTIRE file** with:

```bash
#!/bin/sh
set -eu

seed_dir="/opt/sa-helper-seed"

seed_path() {
  src="$1"
  dst="$2"

  if [ -d "$src" ]; then
    mkdir -p "$dst"
    cp -an "$src/." "$dst/"
  fi
}

# Seed default data and config (no-clobber)
seed_path "$seed_dir/data" "/app/data"
seed_path "$seed_dir/backend/config" "/app/backend/config"

# Ensure all required directories exist
mkdir -p /app/backend/logs \
         /app/backend/logs/backups/system \
         /app/backend/logs/backups/users \
         /app/backend/logs/backups/full \
         /app/backend/app/static/extensions \
         /app/backend/app/templates \
         /app/data/payment_screenshots \
         /app/data/exam_offline

# Run Alembic migrations (skip in test mode)
if [ "${APP_ENV:-production}" != "test" ]; then
  echo "Running Alembic migrations..."
  cd /app/backend && python -m alembic upgrade head 2>&1 || echo "WARNING: Alembic migration failed — continuing with existing schema"
  cd /app
fi

exec "$@"
```

---

## T21: Add Production Docker Compose

### Goal

Create a production-specific compose file with resource limits, health checks, and backup volume.

**Create NEW file**: `docker-compose.prod.yml`

```yaml
# Production overrides — use with: docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
services:
  sa-helper:
    restart: unless-stopped
    init: true
    stop_grace_period: 60s
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
      - QUEUE_WORKERS=6
      - EXAM_OCR_CONCURRENCY=4
    healthcheck:
      test: ["CMD", "curl", "-sf", "http://localhost:8080/health"]
      interval: 30s
      timeout: 10s
      start_period: 15s
      retries: 3
    logging:
      driver: "json-file"
      options:
        max-size: "50m"
        max-file: "5"

  telegram-bot:
    restart: unless-stopped
    init: true
    depends_on:
      sa-helper:
        condition: service_healthy
    deploy:
      resources:
        limits:
          cpus: "0.5"
          memory: 512M
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
```

---

## T22: Improve Dockerfile Health Check

### Goal

Add a HEALTHCHECK instruction and install rclone.

**File**: `Dockerfile`

**Read the Dockerfile first.** Then make these surgical edits:

### Step 22.1: Add rclone install

Find the `RUN apt-get install` or `RUN pip install` block in the final stage. Add rclone installation:

```dockerfile
# Add AFTER existing system package installs (near tesseract-ocr install)
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && curl -O https://downloads.rclone.org/current/rclone-current-linux-arm64.deb \
    && dpkg -i rclone-current-linux-arm64.deb \
    && rm rclone-current-linux-arm64.deb \
    && apt-get clean && rm -rf /var/lib/apt/lists/*
```

> **Note**: Check the Dockerfile's base image architecture. If it's `amd64`, use `rclone-current-linux-amd64.deb` instead. If uncertain, use: `curl https://rclone.org/install.sh | bash` instead.

### Step 22.2: Add HEALTHCHECK

**Add at the end of the Dockerfile**, before the CMD/ENTRYPOINT:

```dockerfile
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD curl -sf http://localhost:8080/health || exit 1
```

---

## Verification

```bash
# 1. Test entrypoint syntax
docker run --rm -v "$(pwd)/docker-entrypoint.sh:/test.sh" alpine sh -c "sh -n /test.sh && echo OK"

# 2. Build image
docker build -t sa-helper:test .

# 3. Test health check
docker run -d --name test-health \
  -e AUTH_HASH_SALT=test -e ADMIN_TOKEN=test \
  -p 8080:8080 sa-helper:test
sleep 10
curl -sf http://localhost:8080/health
docker stop test-health && docker rm test-health
```

---

## Summary of Changes

| File | Change |
|------|--------|
| `docker-entrypoint.sh` | Rewrite — add Alembic, backup dirs, error handling |
| `docker-compose.prod.yml` | [NEW] Production overrides with resource limits |
| `Dockerfile` | +~5 lines — HEALTHCHECK + rclone install |
