# TASK.md - T29-T31 Modular Monolith Route Decomposition

## Goal
Execute tasks T29 through T31: split `routes.py` into focused v1 route modules, add service boundary docs, and add module-grouping comments in container.

## Status
COMPLETE

## Scope Included
- Read mandatory docs and required source files before editing
- Implement T29, T30, T31 in order
- Run backend tests
- Update `STATE.md`
- Commit with message: `[T29-T31] Modular monolith — route decomposition + service boundaries`

## Scope Excluded
- Unrelated refactors/features
- Destructive commands
- Files outside project root

## Plan
- [x] Read AGENTS.md, implementation plan, and T29-T31 task spec
- [x] Read required source files before editing
- [x] Read `backend/app/api/routes.py` completely before edits
- [x] Capture route inventory before split (count + method/path list)
- [x] Implement T29 (`v1_routes/` module extraction + `routes.py` composition)
- [x] Implement T30 (`backend/app/services/__init__.py` boundary docs)
- [x] Implement T31 (`container.py` grouping comments only)
- [x] Verify route inventory after split matches before
- [x] Run `cd backend && python -m pytest tests/ -v`
- [x] Update TASK.md/STATE.md
- [ ] Commit required changes

## Verification
- Route count before split: `20`
- Route count after split: `20`
- Method/path inventory unchanged across split
- `cd backend && python -m pytest tests/ -v` -> `24 passed, 1 warning`
