# TASK.md - Implement Exam Workflow Quotas

## Goal
Implement the deferred rate-limit design: captcha remains request-level RPM limited, while MCQ/stall exam automation is counted as complete exam workflows with daily/monthly quotas instead of per-question solves.

## Status
COMPLETE

## Scope Included
- Inspect current API auth, rate-limit middleware, usage-cycle service, exam routes, and extension exam workflow messages.
- Identify the safest completion signal for a full mock/stall exam workflow.
- Add backend quota enforcement/recording for exam workflows.
- Add minimal extension call to record a completed exam workflow after the final exam result.
- Preserve existing captcha/normal request rate limiting.
- Run targeted backend/frontend/extension verification and update STATE.md.

## Scope Excluded
- Rewriting the auth/rate limiter architecture.
- Changing live real-exam behavior outside the mock/stall exam completion flow.
- Changing plan UI fields beyond what already exists.
- Destructive commands.

## Plan
- [x] Sync AGENTS.md/STATE.md/TASK.md and worktree state.
- [x] Read current rate-limit, usage-cycle, auth, exam route, and extension workflow files.
- [x] Add backend exam workflow quota endpoint/service path.
- [x] Add extension completion call only at mock/stall exam done stage.
- [x] Verify tests/build/import and targeted grep/smoke checks.
- [x] Update STATE.md.

## Verification
- Backend py_compile/import checks for changed modules.
- Backend tests: `cd backend && ../.venv/bin/python -m pytest tests/ -v --tb=short`.
- Frontend build only if frontend touched.
- Grep to ensure workflow quota call is only in mock/stall exam path.
