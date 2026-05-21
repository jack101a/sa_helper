# TASK.md - Telegram Fixed QR Payment Flow

## Goal
Switch Telegram payment flow to fixed QR-based per-plan instructions and screenshot submission, without tap-to-pay deep links.

## Status
COMPLETE

## Scope Included
- Remove inline tap-to-pay button behavior from Telegram plan selection.
- Add per-plan fixed QR source resolution from settings.
- Add per-plan QR upload endpoint and admin upload control.
- Keep dynamic amount/reference generation.
- Ensure screenshot upload creates/updates the pending user and payment record.
- Show user name, mobile, plan, screenshot, and submitted time in admin payment review.
- Verify compile for touched backend modules.

## Scope Excluded
- Razorpay or any payment gateway integration.
- Admin UI redesign.
- Exam/live solving behavior changes.

## Plan
- [x] Re-read Telegram payment and admin payment code paths.
- [x] Implement fixed-QR-first behavior in `telegram_bot.py`.
- [x] Add admin per-plan QR upload support.
- [x] Make screenshot submission create/update pending payment records.
- [x] Add admin review fields for user/mobile/plan/submitted time.
- [x] Run compile verification.
- [x] Update STATE.md.

## Verification
- `./.venv/bin/python -m py_compile backend/app/services/telegram_bot.py backend/app/api/admin_routes/payments.py backend/app/main.py`
