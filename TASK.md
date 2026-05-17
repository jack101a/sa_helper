# TASK.md - Docker Runtime Blank Dashboard and Service Fixes

## Goal
Fix deployed Docker runtime issues: blank admin dashboard, Postgres password sync SQL error, and Telegram Markdown parse failures.

## Status
COMPLETED

## Scope Included
- Restore stripped frontend imports used at runtime by the admin shell.
- Fix Postgres password sync command to avoid psql variable syntax errors.
- Remove fragile Markdown parse mode from Telegram text replies that include dynamic content.
- Verify frontend build/lint, backend lint/tests, and compose config.

## Scope Excluded
- Browser-side live production inspection.
- Changing production secrets or stopping external Telegram bot processes.

## Plan
- [x] Diagnose blank admin dashboard from missing runtime imports.
- [x] Patch frontend imports.
- [x] Patch Postgres password sync command.
- [x] Patch Telegram reply parse mode.
- [x] Run verification commands.

## Verification Approach
- `npm --prefix frontend run build`
- `npm --prefix frontend run lint`
- `ruff check backend/app backend/tests`
- `python -m pytest backend/tests -q`
- `docker compose config`
