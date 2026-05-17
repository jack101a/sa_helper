# TASK.md - Admin Dashboard Runtime Import Recovery

## Goal
Fix deployed admin dashboard runtime failures caused by missing JSX imports after frontend cleanup.

## Status
COMPLETED

## Scope Included
- Restore known-good frontend component imports.
- Add `react/jsx-no-undef` lint coverage to catch missing JSX imports before deployment.
- Verify frontend build/lint, backend lint/tests, and compose config.

## Scope Excluded
- Browser-side live production inspection.
- Changing production secrets or stopping external Telegram bot processes.

## Plan
- [x] Diagnose dashboard crash from missing JSX imports like `NavLink`.
- [x] Restore frontend app/component imports from known-good history.
- [x] Add strict JSX undefined lint coverage.
- [x] Run verification commands.

## Verification Approach
- `npm --prefix frontend run build`
- `npm --prefix frontend run lint`
- `ruff check backend/app backend/tests`
- `python -m pytest backend/tests -q`
- `docker compose config`
