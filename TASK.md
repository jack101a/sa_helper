# TASK.md - T20-T22 Docker Production Hardening

## Goal
Execute tasks T20 through T22: hardened entrypoint, production compose overrides, and Dockerfile health/rclone improvements.

## Status
COMPLETE

## Scope Included
- Read mandatory docs and required source files before editing
- Implement T20, T21, T22 in order
- Run required syntax verification for entrypoint
- Update `STATE.md`
- Commit with message: `[T20-T22] Docker production hardening`

## Scope Excluded
- Unrelated refactors/features
- Destructive commands
- Files outside project root

## Plan
- [x] Read AGENTS.md, implementation plan, and T20-T22 task spec
- [x] Read required source files before editing
- [x] Implement T20 (`docker-entrypoint.sh`)
- [x] Implement T21 (`docker-compose.prod.yml`)
- [x] Implement T22 (`Dockerfile`)
- [x] Run `sh -n docker-entrypoint.sh`
- [x] Update TASK.md/STATE.md
- [ ] Commit required changes

## Verification
- `sh -n docker-entrypoint.sh && echo OK` -> `OK`
