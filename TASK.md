# TASK.md - T16-T19 Test Harness + CI Pipeline

## Goal
Execute tasks T16 through T19: shared test fixtures, auth middleware tests, admin guard tests, and CI workflow.

## Status
COMPLETE

## Scope Included
- Read mandatory docs and required source files before editing
- Implement T16, T17, T18, T19 in order
- Run required pytest suite and fix failures
- Update `STATE.md`
- Commit with message: `[T16-T19] Test harness + CI pipeline`

## Scope Excluded
- Unrelated refactors/features
- Destructive commands
- Files outside project root

## Plan
- [x] Read AGENTS.md, implementation plan, and T16-T19 task spec
- [x] Read required source files before editing
- [x] Implement T16 (`backend/tests/conftest.py`)
- [x] Implement T17 (`backend/tests/test_auth_middleware.py`)
- [x] Implement T18 (`backend/tests/test_admin_guard.py`)
- [x] Implement T19 (`.github/workflows/ci.yml`)
- [x] Run `cd backend && python -m pytest tests/ -v --tb=short`
- [x] Update TASK.md/STATE.md
- [ ] Commit required changes

## Verification
- `cd backend && python -m pytest tests/ -v --tb=short` -> `24 passed, 1 warning`
