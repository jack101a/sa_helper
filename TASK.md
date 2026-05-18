# TASK.md - Postgres-First Production Runtime

## Goal
Make production runtime Postgres-first and reliable, with default compose running only API + Postgres, in-process solving by default, and no production SQLite call paths.

## Status
IN PROGRESS (runtime Docker verification pending)

## Scope Included
- Postgres default env/config and safe DB URL handling.
- Compose defaults cleanup (api + postgres only, optional worker/redis/telegram profiles).
- Alembic baseline reset for fresh Postgres schema.
- Disable production `create_all` default.
- Remove Postgres password mutation startup hack.
- Fix async await bug in feedback flow.
- Ensure production routes/services do not call SQLite connection when `DB_TYPE=postgresql`.
- Add readiness endpoint and compose healthcheck on readiness.
- Add operational Postgres backup script (`pg_dump` + optional rclone).
- Update `.env.example` and runtime docs/comments tied to actual code behavior.

## Scope Excluded
- Legacy data migration from SQLite to Postgres.
- Non-production-only offline scripts unless they break runtime paths.

## Plan
- [x] Audit runtime wiring and identify SQLite-only production call paths.
- [x] Patch config/container/main defaults for Postgres + no implicit create_all.
- [x] Patch compose for default api+postgres and optional profiles.
- [x] Replace Alembic history with clean baseline migration from models.
- [x] Fix async dispatch await bug and validate feedback route path.
- [x] Add readiness checks (DB + optional Redis when enabled).
- [x] Add backup script and integrate env variables.
- [ ] Run verification: alembic upgrade on empty DB, compose config, targeted tests/smoke checks.
- [ ] Update STATE.md with final status, outputs, and next step.

## Verification Approach
- `docker compose config`
- `docker compose up -d postgres`
- `alembic upgrade head` (fresh DB)
- app import/start smoke with `DB_TYPE=postgresql` and `CREATE_ALL_TABLES=false`
- targeted API route tests/smoke for key/solve/feedback/admin paths
- grep checks for SQLite connection usage in production path files

## Verification Notes (Current Session)
- `python -m compileall backend/app backend/migrations` succeeded.
- `python -m pytest backend/tests -q` succeeded (`10 passed`).
- `npm --prefix frontend run build` succeeded.
- Docker CLI is not installed in this environment, so `docker compose ...` and `docker build .` runtime checks are pending.

## Follow-up Task (Startup Bundle Import)
- [x] Add backend admin endpoint to import startup bundle ZIP (`system-data.json` + `files/` extraction).
- [x] Wire admin dashboard UI action to upload and trigger startup bundle import.
- [x] Re-run compile/build checks after wiring.
