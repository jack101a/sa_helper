# TASK.md - Production Repository Cleanup

## Goal
Clean the repository for production, remove personal/generated artifacts from the committed tree, verify extension/backend health checks, then commit and push a clean `master` branch.

## Status
BLOCKED

## Scope Included
- Inspect current git status, branch, remotes, tracked large files, and secret-like strings.
- Remove hardcoded extension autofill rules and keep backend-driven behavior.
- Keep STALL cookie cleanup scoped to Sarathi.
- Remove generated/import backup artifacts from the tracked tree if they are not production source.
- Verify syntax/tests that are available locally.
- Commit cleanup and push to `origin master`.

## Scope Excluded
- No destructive git reset/checkout.
- Use a clean baseline branch if existing branch history contains sensitive artifacts.
- No broad feature refactor.

## Plan
- [x] Read AGENTS/STATE/TASK and current git status.
- [ ] Audit tracked files for artifacts and secret-like values.
- [x] Apply cleanup edits/removals.
- [x] Run verification commands.
- [x] Update STATE.md.
- [ ] Commit sanitized working tree.
- [ ] Push clean `master` branch. Blocked: no GitHub credentials available in this environment.

## Verification
- `node --check extension/background.js`
- `node --check extension/modules/autofill.js`
- `node --check extension/popup/popup.js`
- `PYTHONPATH=backend .venv/bin/python -m pytest backend/tests`
- `npm run build`
- Secret/artifact scan summary
- `git status --short --branch`
