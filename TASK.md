# TASK.md - Stabilization Fixes From AI Reports

## Goal
Implement the high-value follow-up fixes identified from `.ai-reports/`: admin login/session hardening, Telegram state safety, plan burst limits, capacity config alignment, backup restore completion, and focused regression coverage.

## Status
COMPLETE

## Scope Included
- Admin login brute-force rate limiting
- Non-deterministic admin session tokens with server-side expiry
- Atomic Telegram mock/registration state writes
- `rate_limit_burst` support for plans where locally feasible
- Production capacity config alignment
- System/user backup restore completion where current backup format supports it
- Focused tests for the implemented fixes
- Verification with backend tests and frontend build where touched

## Scope Excluded
- Full SQLAlchemy legacy table migration
- PostgreSQL production migration
- Major route/service refactors
- Real live exam behavior changes
- Destructive git commands

## Plan
- [x] Read AGENTS.md, STATE.md, existing TASK.md, and worktree status
- [x] Inspect relevant backend/frontend/extension files before edits
- [x] Implement admin session and login rate-limit hardening
- [x] Implement atomic Telegram state writes
- [x] Implement plan `rate_limit_burst` propagation/UI
- [x] Apply capacity settings in production config/compose
- [x] Implement supported backup restore endpoints/service helpers
- [x] Add/update focused tests
- [x] Run backend tests
- [x] Run frontend build if frontend changed
- [x] Update STATE.md

## Verification
- `cd backend && . ../.venv/bin/activate && AUTH_HASH_SALT=test-salt ADMIN_TOKEN=test-token python -m pytest tests/ -v`
- `cd frontend && npm run build`
