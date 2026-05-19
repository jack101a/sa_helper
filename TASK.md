# TASK.md - T23-T25 Database Unification

## Goal
Execute tasks T23 through T25: guard ORM create_all, add Alembic baseline for legacy schema, and refactor `Database.init()` to migration-first with fallback.

## Status
COMPLETE

## Scope Included
- Read mandatory docs and required source files before editing
- Implement T23, T24, T25 in order
- Verify Alembic fresh DB and `Database.init()` fallback DB table parity
- Run backend tests
- Update `STATE.md`
- Commit with message: `[T23-T25] Database unification — Alembic baseline + init() guard`

## Scope Excluded
- Unrelated refactors/features
- Destructive commands
- Files outside project root

## Plan
- [x] Read AGENTS.md, implementation plan, and T23-T25 task spec
- [x] Read required source files before editing
- [x] Implement T23 (`container.py` debug guard)
- [x] Implement T24 (new baseline migration + migration-chain guards)
- [x] Implement T25 (`database.py` init fallback pattern)
- [x] Verify table parity: Alembic fresh DB vs init fallback DB
- [x] Run `cd backend && python -m pytest tests/ -v`
- [x] Update TASK.md/STATE.md
- [ ] Commit required changes

## Verification
- `alembic upgrade head` on fresh DB succeeds
- fresh-Alembic and fresh-init table lists match (excluding `alembic_version`)
- `cd backend && python -m pytest tests/ -v` -> `24 passed, 1 warning`
