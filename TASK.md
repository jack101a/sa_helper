# TASK.md - T26-T28 Security Hardening

## Goal
Execute tasks T26 through T28: auth fallthrough error logging, base64 image validation limits, and admin session cookie hardening.

## Status
COMPLETE

## Scope Included
- Read mandatory docs and required source files before editing
- Implement T26, T27, T28 in order
- Run backend tests
- Update `STATE.md`
- Commit with message: `[T26-T28] Security hardening — auth logging, image validation, cookie flags`

## Scope Excluded
- Unrelated refactors/features
- Destructive commands
- Files outside project root

## Plan
- [x] Read AGENTS.md, implementation plan, and T26-T28 task spec
- [x] Read required source files before editing
- [x] Implement T26 (`auth_middleware.py` error-level fallthrough logging)
- [x] Implement T27 (`_b64_to_pil` payload/image limits)
- [x] Implement T28 (admin session cookie flags)
- [x] Run `cd backend && python -m pytest tests/ -v`
- [x] Update TASK.md/STATE.md
- [ ] Commit required changes

## Verification
- `cd backend && python -m pytest tests/ -v` -> `24 passed, 1 warning`
