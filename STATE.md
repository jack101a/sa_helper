# STATE.md - Implement Exam Workflow Quotas

## Status
COMPLETE

## Active Task
Implemented the deferred rate-limit redesign for MCQ/stall exam automation: captcha and normal API traffic remain request-rate limited, while mock/stall MCQ usage is checked at exam workflow start and counted once at final exam result.

## Last Files Modified
- `backend/app/api/v1_routes/exam.py`
- `backend/app/core/models.py`
- `backend/app/middleware/rate_limit_middleware.py`
- `backend/app/services/usage_cycle_service.py`
- `backend/migrations/versions/a4b5c6d7e8f9_add_exam_workflow_usage.py`
- `extension/background.js`
- `extension/modules/exam.js`
- `TASK.md`
- `STATE.md`

## Last Command Run
`cd frontend && npm run build`

## Last Output/Error
- Backend compile passed for changed quota modules.
- Extension JS syntax passed: `node --check extension/modules/exam.js` and `node --check extension/background.js`.
- Backend app import passed: `OK`.
- Backend tests passed: `25 passed, 2 warnings in 2.09s`.
- Alembic fresh upgrade passed and created `exam_workflow_usage`: output `True`.
- Direct quota service smoke passed: first workflow counted, duplicate workflow did not double-count, next workflow was blocked by `daily_quota_exceeded` when daily limit was `1`.
- Frontend build passed: `npm run build` completed successfully.
- `git diff --check` passed.

## Implementation Notes
- New endpoints: `/v1/exam/workflow/start` and `/v1/exam/workflow/complete`.
- Monthly quota uses existing `UsageCycle.used_count` and each completed exam counts as `1`.
- Daily quota uses the new `exam_workflow_usage` table and defaults to `5` via platform setting `exam.workflow_daily_limit` when unset.
- Workflow completion is idempotent by `workflow_id`, so repeated result detection does not double-count.
- `/v1/exam/solve` and `/v1/exam/feedback` are excluded from per-request rate limiting so a 15-question workflow is not cut off mid-exam by per-question throttling.
- Captcha routes continue using request-level RPM limiting.

## Immediate Next Step
Review the combined uncommitted changes and commit/push from `scaling-check` when ready.
