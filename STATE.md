# STATE.md - Split API Workers From Schedulers

## Status
COMPLETE

## Active Task
Restored two API workers safely by moving backup, MCQ merge, and subscription expiry loops into a dedicated scheduler service.

## Last Files Modified
- `backend/app/main.py`
- `backend/app/scheduler.py`
- `Dockerfile`
- `docker-compose.yml`
- `docker-compose.prod.yml`
- `docker-entrypoint.sh`
- `TASK.md`
- `STATE.md`

## Last Command Run
`docker build -t sa-helper-docker-audit:latest .`

## Last Output/Error
- API Docker CMD is back to `uvicorn ... --workers 2`.
- API compose env has `RUN_BACKGROUND_TASKS=false`, so API workers do not run duplicate schedulers.
- New `scheduler` service runs `python -m app.scheduler` as the single owner of backup, MCQ merge, and subscription expiry loops.
- API container runs migrations with `RUN_MIGRATIONS=true`; scheduler and Telegram containers use `RUN_MIGRATIONS=false` to avoid migration races.
- Production compose config rendered successfully with API, scheduler, and Telegram services.
- Python compile/import checks passed.
- Fresh Alembic migration plus production-style import/query passed: `OK 2.0.0 0`.
- Docker build still cannot run locally: `/var/run/docker.sock` permission denied.

## Immediate Next Step
Push `scaling-check` and use GitHub Actions to perform the real multi-arch Docker build. Keep production env secrets non-empty: `AUTH_HASH_SALT`, `ADMIN_TOKEN`, and `ADMIN_PASSWORD`.
