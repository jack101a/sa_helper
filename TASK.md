# TASK.md - Split API Workers From Schedulers

## Goal
Restore API performance with two uvicorn workers while keeping backup, MCQ merge, and subscription expiry schedulers single-instance in Docker deployment.

## Status
COMPLETE

## Scope Included
- Add a dedicated scheduler process entrypoint.
- Gate FastAPI lifespan background loops behind an env flag.
- Restore API Docker CMD to two uvicorn workers.
- Add a scheduler service to Docker Compose sharing the same volumes/env.
- Ensure only the API container runs Alembic migrations.
- Validate Python imports and compose config.
- Update STATE.md.

## Scope Excluded
- Pushing to GitHub.
- Full Docker image build, because Docker socket access is denied for this user.
- Changing solver queue internals or captcha/MCQ algorithms.

## Plan
- [x] Read AGENTS.md, STATE.md, TASK.md, and current deployment files.
- [x] Inspect `main.py`, Dockerfile, compose files before edits.
- [x] Add scheduler module and env-gated API background tasks.
- [x] Restore API workers to 2 and add scheduler service.
- [x] Gate migrations to API container only.
- [x] Run verification commands.
- [x] Update STATE.md.

## Verification
- `cd backend && ../.venv/bin/python -m py_compile app/main.py app/scheduler.py` passed.
- Production-style import with `RUN_BACKGROUND_TASKS=false` passed.
- Scheduler module import/sanity check passed: `scheduler OK True`.
- `docker-compose -f docker-compose.yml -f docker-compose.prod.yml config` passed.
- Fresh Alembic migration plus production-style import/query passed: `OK 2.0.0 0`.
- Docker build attempt failed due local Docker socket permission denied.
