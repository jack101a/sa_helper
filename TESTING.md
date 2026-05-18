# Docker Production Validation

## 0) Prepare env
```bash
cp .env.docker.example .env
# Edit .env and set strong secrets:
# ADMIN_PASSWORD, ADMIN_TOKEN, AUTH_HASH_SALT, POSTGRES_PASSWORD, TELEGRAM_BOT_TOKEN
```

## 1) Verify compose service sets
```bash
docker compose config --services
# Expected default services:
# postgres
# api
# telegram-bot

# Scale profile adds only redis + worker:
docker compose --profile scale config --services
# Expected scale services:
# postgres
# api
# telegram-bot
# redis
# worker
```

## 2) Fresh runtime reset
```bash
docker compose down -v
```

## 3) Start Postgres only
```bash
docker compose up -d postgres
docker compose ps
```

## 4) Run migrations on empty DB
```bash
docker compose run --rm \
  -e RUN_ALEMBIC_MIGRATIONS=true \
  -e CREATE_ALL_TABLES=false \
  api sh -lc "cd /app/backend && alembic upgrade head"
```

## 5) Start API + Telegram bot
```bash
docker compose up -d api telegram-bot
docker compose ps
```

## 6) Readiness check
```bash
curl -fsS http://localhost:${API_PORT:-8088}/readyz
```

## 7) Telegram bot runtime check
```bash
docker compose logs --tail=100 telegram-bot
docker compose ps telegram-bot
```

## 8) API key create + verify
```bash
curl -fsS -X POST http://localhost:${API_PORT:-8088}/v1/key/create \
  -H "x-admin-token: ${ADMIN_TOKEN}" \
  -H "content-type: application/json" \
  -d '{"name":"smoke-key","expiry_days":30}'

curl -fsS http://localhost:${API_PORT:-8088}/v1/auth/verify \
  -H "x-api-key: <PASTE_CREATED_KEY>"
```

## 9) Solve + feedback smoke
```bash
curl -fsS -X POST http://localhost:${API_PORT:-8088}/v1/solve \
  -H "x-api-key: <PASTE_CREATED_KEY>" \
  -H "content-type: application/json" \
  -d '{"type":"image","mode":"fast","payload_base64":"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z0okAAAAASUVORK5CYII=","domain":"example.com"}'

curl -fsS -X POST http://localhost:${API_PORT:-8088}/v1/exam/feedback \
  -H "x-api-key: <PASTE_CREATED_KEY>" \
  -H "content-type: application/json" \
  -d '{"question_image_b64":"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z0okAAAAASUVORK5CYII=","option_images_b64":["iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z0okAAAAASUVORK5CYII=","iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z0okAAAAASUVORK5CYII=","iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z0okAAAAASUVORK5CYII=","iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z0okAAAAASUVORK5CYII="],"selected_option":1,"is_correct":true,"domain":"example.com"}'
```

## 10) Required binaries check
```bash
docker compose exec api sh -lc "pg_dump --version && pg_dumpall --version && rclone --version && age --version && gpg --version && tar --version && gzip --version"
```

## 11) Backup setup notes
- `RCLONE_CONFIG` points to `/app/runtime/rclone/rclone.conf`.
- Upload `rclone.conf` from admin UI (`/admin` backup section) or pre-mount file into runtime path.
- Set `BACKUP_AGE_RECIPIENT` before enabling age encryption.
- Set `BACKUP_TELEGRAM_CHAT_ID` before enabling Telegram backup file upload.

## 12) Backup smoke
```bash
curl -fsS http://localhost:${API_PORT:-8088}/admin/api/system/backup/config
curl -fsS -X POST http://localhost:${API_PORT:-8088}/admin/api/system/backup/rclone-config -F rclone_file=@./rclone.conf
curl -fsS -X POST http://localhost:${API_PORT:-8088}/admin/api/system/backup/rclone/test -H "content-type: application/json" -d '{"mode":"version"}'
curl -fsS -X POST http://localhost:${API_PORT:-8088}/admin/api/system/backup/telegram/test-file -H "content-type: application/json" -d '{"chat_id":"<chat-id-or-@channel>"}'
curl -fsS -X POST http://localhost:${API_PORT:-8088}/admin/api/system/backup/run -H "content-type: application/json" -d '{"telegram":true,"rclone":true}'
curl -fsS http://localhost:${API_PORT:-8088}/admin/api/system/backup/history
```

## 13) Optional scale profile runtime
```bash
docker compose --profile scale up -d redis worker
docker compose --profile scale ps
```
