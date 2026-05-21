# TASK.md - Plan Delete Migration Flow

## Goal
Allow admin to deactivate a plan by selecting a target plan and auto-migrating linked subscriptions.

## Status
COMPLETE

## Scope Included
- Backend: support `target_plan_id` on `DELETE /admin/api/plans/{plan_id}`.
- Backend: migrate linked `user_subscriptions` before deactivating source plan.
- Frontend: replace plain confirm with deactivation modal that lets admin choose target plan.
- Frontend: show migrated subscription count toast.

## Scope Excluded
- No schema changes.
- No hard-delete of plan rows.
- No changes to old/historical expired/cancelled subscription records.

## Plan
- [x] Read subscription models, service, admin routes, and plans panel.
- [x] Add migration-aware delete in `SubscriptionService.delete_plan`.
- [x] Update admin delete endpoint to accept JSON body with `target_plan_id`.
- [x] Add plans-panel deactivation modal with target plan selector.
- [x] Run backend syntax checks and frontend build.
- [x] Update STATE.md.

## Verification
- `backend/.venv/bin/python -m py_compile backend/app/services/subscription_service.py backend/app/api/admin_routes/subscriptions.py`
- `cd frontend && npm run build`
