# TASK.md - T11-T15 Plan Entitlements, Device Limits, Lifecycle

## Goal
Execute tasks T11 through T15: plan entitlements columns, payment entitlement copy, plan-based device limits, subscription auto-expiry, and Telegram /renew flow.

## Status
COMPLETE

## Scope Included
- Read mandatory docs and required source files before editing
- Implement T11, T12, T13, T14, T15 in order
- Run verification commands
- Update `STATE.md`
- Commit with message: `[T11-T15] Plan entitlements, device limits, auto-expiry, /renew`

## Scope Excluded
- Unrelated refactors/features
- Destructive commands
- Files outside project root

## Plan
- [x] Read AGENTS.md, implementation plan, and T11-T15 task spec
- [x] Read required source files before editing
- [x] Implement T11 (model columns, migration, create_plan wiring)
- [x] Implement T12 (copy allowed_services into entitlements on approval)
- [x] Implement T13 (plan-based max_devices in bind_device)
- [x] Implement T14 (expire_overdue + expiry scheduler)
- [x] Implement T15 (/renew command + 3-day warning)
- [x] Run verification commands
- [x] Update TASK.md/STATE.md
- [ ] Commit required changes

## Verification
- `python -c "from app.core.models import SubscriptionPlan; print('max_devices' in [c.name for c in SubscriptionPlan.__table__.columns])"` -> `True`
- `python -c "from app.services.subscription_service import SubscriptionService; print(hasattr(SubscriptionService, 'expire_overdue'))"` -> `True`
- `python -c "from app.services.telegram_bot import *; print('OK')"` -> `OK`
- `python -m py_compile ...` on all edited files -> success
