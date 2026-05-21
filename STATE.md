# STATE.md - Telegram Fixed QR Payment Flow

## Status
COMPLETE

## Active Task
Implemented fixed QR payment flow for Telegram registration: admin can upload QR per plan, plan selection sends that plan QR, screenshot submission creates/updates the pending user/payment record, and admin review shows the key verification fields.

## Last Files Modified
- `backend/app/services/telegram_bot.py`
- `backend/app/core/models.py`
- `backend/app/api/admin_routes/settings.py`
- `backend/app/services/payment_service.py`
- `frontend/src/app/components/PaymentsPanel.jsx`
- `frontend/src/app/components/PlansPanel.jsx`
- `TASK.md`
- `STATE.md`

## Last Command Run
`git diff --check && git diff --stat`

## Last Output/Error
- Backend py_compile passed for `telegram_bot.py`, `models.py`, `payment_service.py`, `payments.py`, and `settings.py`.
- Backend app import passed with `OK`.
- Frontend build passed with `vite build`.
- `git diff --check` passed.

## Runtime Configuration
Telegram bot now resolves fixed QR in this order:
1. Uploaded local plan QR file: `data/uploads/qr_plan_<plan_id>.*`
2. `payment.qr_image_url_plan_<plan_id>`
3. `payment.plan_qr_map` (JSON, e.g. `{"1":"https://.../basic.png","2":"https://.../pro.png"}`)
4. `payment.qr_image_url` (global fallback)

If none is configured, bot falls back to generated UPI QR.

## Immediate Next Step
Configure fixed QR URLs per plan and test Telegram registration against the deployed bot image.
