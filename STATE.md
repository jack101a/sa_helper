# STATE.md - Telegram Domain Inline Pay Button

## Status
COMPLETE

## Active Task
Implemented domain-based Telegram inline pay flow: bot now emits an HTTPS link to backend `/pay/upi`, which validates signed token and opens UPI deep link with fallback instructions.

## Last Files Modified
- `backend/app/core/payment_links.py` (new)
- `backend/app/services/telegram_bot.py`
- `backend/app/main.py`
- `TASK.md`
- `STATE.md`

## Last Command Run
`cd backend && DEBUG=false RUN_BACKGROUND_TASKS=false AUTH_HASH_SALT=test-salt ADMIN_TOKEN=test-token ADMIN_USERNAME=admin ADMIN_PASSWORD=123456 PUBLIC_BASE_URL=https://example.com SQLITE_PATH=/tmp/sa-helper-paylink.db ../.venv/bin/python -c "from app.main import app; print('OK')"`

## Last Output/Error
- `py_compile` passed for all touched files.
- Token encode/decode smoke check passed: `token_ok True zero.one@ybl 99.00`.
- App import passed: `OK`.

## Runtime Requirement
- Set `PUBLIC_BASE_URL` env var OR platform setting `server.public_base_url` to your public HTTPS domain.
- Without it, bot falls back to QR/manual instructions and no inline tap button.

## Immediate Next Step
Deploy this patch and set the public base URL so Telegram plan selection shows clickable HTTPS payment button.
