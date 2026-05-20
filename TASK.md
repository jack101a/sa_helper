# TASK.md - Telegram Domain Inline Pay Button

## Goal
Implement Telegram-safe inline payment button using your HTTPS domain, with backend endpoint redirecting to UPI deep link.

## Status
COMPLETE

## Scope Included
- Add signed payment-link token helpers.
- Add `/pay/upi` public endpoint that validates token and redirects/opens UPI link with fallback page.
- Wire Telegram plan selection button to domain URL instead of direct `upi://`.
- Keep QR/manual fallback intact.
- Verify compile/import and token decode.

## Scope Excluded
- Full payment provider integration.
- Frontend/admin UI changes.

## Plan
- [x] Read current Telegram flow and app routing.
- [x] Add shared signed payment-link helper module.
- [x] Add `/pay/upi` endpoint in backend.
- [x] Wire Telegram button to HTTPS domain payment URL.
- [x] Verify compile/import and token roundtrip.
- [x] Update STATE.md.

## Verification
- `cd backend && ../.venv/bin/python -m py_compile app/core/payment_links.py app/services/telegram_bot.py app/main.py`
- token roundtrip check: `encode_upi_payload` + `decode_upi_payload` => `token_ok True`
- `cd backend && DEBUG=false RUN_BACKGROUND_TASKS=false AUTH_HASH_SALT=test-salt ADMIN_TOKEN=test-token ADMIN_USERNAME=admin ADMIN_PASSWORD=123456 PUBLIC_BASE_URL=https://example.com SQLITE_PATH=/tmp/sa-helper-paylink.db ../.venv/bin/python -c "from app.main import app; print('OK')"`
