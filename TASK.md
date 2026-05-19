# TASK.md - T1-T6 MCQ Solver Performance Improvements

## Goal
Implement tasks T1 through T6 for MCQ solver performance improvements: in-memory learned index, feedback hot-reload, auto-merge service, merge scheduler, and admin merge/stats endpoints.

## Status
COMPLETE

## Scope Included
- Execute T1-T3 from `.ai-reports/06a-task-p0-inmemory-index.md`
- Execute T4-T6 from `.ai-reports/06b-task-p1-auto-merge.md`
- Run verification commands after each task group
- Update `STATE.md` at completion
- Commit with message: `[T1-T6] In-memory hash index + auto-merge service`

## Scope Excluded
- Any features beyond task specifications
- Destructive commands
- Files outside current project root

## Plan
- [x] Read AGENTS.md, STATE.md, TASK.md and task specifications
- [x] Read all required source files for T1-T3
- [x] Implement T1
- [x] Implement T2
- [x] Implement T3
- [x] Run T1-T3 verification commands
- [x] Read all required source files for T4-T6
- [x] Implement T4
- [x] Implement T5
- [x] Implement T6
- [x] Run T4-T6 verification commands
- [x] Update STATE.md and TASK.md completion
- [x] Commit changes with required message

## Verification
- `grep` check for legacy `exam_learned` SQL calls in `solve()` returned no matches
- `python3 -m py_compile` passed for all edited files
- Task-provided import checks requiring runtime deps could not run fully due missing local packages (`numpy`, `pydantic`, `fastapi`)
