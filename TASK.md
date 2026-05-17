# TASK.md - Docker Deployment Runtime Hotfix

## Goal
Fix production Docker runtime issues: blank admin dashboard, broken Postgres password sync command, Telegram Bot API temp directory failure, and unintended Telegram polling conflicts.

## Status
COMPLETED

## Scope Included
- Restore required frontend runtime imports for admin dashboard rendering.
- Fix Postgres password sync command so shell line splitting cannot break `psql` flags.
- Replace Telegram Bot API temp bind mount with tmpfs.
- Make telegram-bot honor `TELEGRAM_BOT_ENABLED=false` before polling.
- Use the moving production image tag for app services so new production builds can deploy the fixed frontend.

## Scope Excluded
- Changing Telegram token ownership or stopping external bot instances outside this stack.
- Reworking admin dashboard UI behavior.

## Plan
- [x] Diagnose blank dashboard from frontend runtime imports.
- [x] Patch compose runtime issues from logs.
- [x] Verify frontend build/lint and compose config.

## Verification Approach
- `npm --prefix frontend run build`
- `npm --prefix frontend run lint`
- `docker compose config`
