# TASK.md - T1-T6 MCQ Solver Performance Improvements

## Goal
Execute tasks T1 through T6 for MCQ solver performance: in-memory learned index, feedback hot-reload, exam auto-merge service, scheduler wiring, and admin merge/training endpoints.

## Status
COMPLETE

## Scope Included
- Re-read mandatory task files and required source files
- Verify T1-T6 implementation state in codebase
- Run task verification commands
- Update `STATE.md`
- Commit with message: `[T1-T6] In-memory hash index + auto-merge service`

## Scope Excluded
- Non-T1-T6 feature work
- Destructive commands
- Broad refactors

## Plan
- [x] Read AGENTS.md, STATE.md, TASK.md, and T1-T6 task specs
- [x] Read all required source files before edits
- [x] Validate T1-T6 code changes are present
- [x] Run verification commands
- [x] Update `STATE.md`
- [x] Commit required task record

## Verification
- `python` command in task is unavailable in this environment; used `python3` fallback
- `python3 -m py_compile` passed for all T1-T6 files
- Runtime import checks blocked by missing deps: `numpy`, `fastapi`, `pydantic`
- `grep` check confirmed no `self._db.exam_learned.get_*` calls remain in `ExamService.solve()`
