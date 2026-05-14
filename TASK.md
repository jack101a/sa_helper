# TASK.md - Push Current Code

## Goal
Commit and push the current code changes to `https://github.com/jack101a/sa_helper/tree/before-scale`.

## Status
IN PROGRESS

## Scope Included
- Verify backend, extension, and frontend changes still pass basic checks.
- Stage source, frontend, extension, package artifact, `TASK.md`, and `STATE.md` changes.
- Leave local runtime database files under `backend/logs/` unstaged.
- Commit and push branch `before-scale` to remote `sa_helper`.

## Scope Excluded
- No new feature work.
- No database/log file commit unless explicitly requested.

## Plan
- [x] Run verification commands.
- [x] Stage intended files only.
- [ ] Commit changes.
- [ ] Push `before-scale` to `sa_helper`.

## Verification Approach
- Run frontend build.
- Run Python compile checks for modified backend files.
- Run JavaScript syntax checks for modified extension files.

## Verification Result
- `npm run build` in `frontend` passed.
- `python -m py_compile ...` for modified backend files passed.
- `node --check extension/modules/exam.js` passed.
- `node --check extension/background.js` passed.

## Staging Result
- Staged code, UI, extension, package artifacts, and task/state files.
- Left `backend/logs/app.db*` unstaged as local runtime data.
