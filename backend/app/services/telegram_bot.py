"""Telegram bot service — registration, plan selection, payment submission.

Uses python-telegram-bot for long-polling. Connects to the same database.
Run as a separate process: python -m app.services.telegram_bot
"""

from __future__ import annotations

import io
import json
import logging
import time
import uuid
from datetime import UTC, datetime
from pathlib import Path

import qrcode

from app.core.db import get_session
from app.core.models import PaymentRecord, SubscriptionPlan, User, UserSubscription

logger = logging.getLogger(__name__)

# Bot states for conversation tracking
STATE_START = "start"
STATE_NAME = "name"
STATE_MOBILE = "mobile"
STATE_PLAN_SELECT = "plan_select"
STATE_PAYMENT_INSTRUCTIONS = "payment_instructions"
STATE_PAYMENT_SUBMIT = "payment_submit"
STATE_COMPLETE = "complete"

# QR image upload directory (for admin-uploaded QR, fallback)
_QR_DIR = Path(__file__).resolve().parents[3] / "data" / "uploads"


def _generate_qr_bytes(url: str) -> io.BytesIO:
    """Generate a QR code PNG from a UPI URL, return as BytesIO."""
    img = qrcode.make(url)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    return buf


def _find_qr_image() -> Path | None:
    """Find the uploaded QR code image file (fallback)."""
    for ext in ("png", "jpg", "jpeg", "gif", "webp"):
        fp = _QR_DIR / f"qr_code.{ext}"
        if fp.exists():
            return fp
    return None


def _make_upi_link(upi_id: str, name: str, amount: float, note: str = "", currency: str = "INR") -> str:
    """Generate a UPI intent deep link for one-click payment."""
    amt = f"{amount:.2f}"
    link = f"upi://pay?pa={upi_id}&pn={name}&am={amt}&cu={currency}"
    if note:
        link += f"&tn={note}"
    return link


class TelegramBotService:
    """Handles Telegram bot registration and payment flow.

    To run: python -m app.services.telegram_bot
    Requires TELEGRAM_BOT_TOKEN env var.
    """

    def __init__(self, token: str, session_factory=None, upi_id: str = "", qr_image_url: str = "",
                 payee_name: str = "ta-ta Extension", payment_note_prefix: str = "Reg"):
        self._token = token
        self._session_factory = session_factory or get_session
        self._user_states: dict[int, dict] = {}  # chat_id -> state dict
        self._upi_id = upi_id
        self._qr_image_url = qr_image_url
        self._payee_name = payee_name
        self._payment_note_prefix = payment_note_prefix
        self._currency = "INR"

        # Persist user states to survive bot restarts
        _data_dir = Path(__file__).resolve().parents[3] / "data"
        _data_dir.mkdir(parents=True, exist_ok=True)
        self._state_file = _data_dir / "telegram_user_states.json"
        self._load_states()

    def _session(self):
        return self._session_factory()

    # ── State Management ──────────────────────────────────────────────────

    def _load_states(self):
        """Restore user states from disk on bot restart."""
        try:
            if self._state_file.exists():
                with self._state_file.open("r", encoding="utf-8") as f:
                    raw = json.load(f)
                # Convert string keys back to int, filter stale states (>30 min old)
                now = time.time()
                for k, v in raw.items():
                    if isinstance(v, dict) and v.get("_ts", 0) > now - 1800:
                        self._user_states[int(k)] = v
                logger.info("telegram_states_loaded", extra={"context": {"count": len(self._user_states)}})
        except Exception as e:
            logger.warning("telegram_states_load_failed", extra={"context": {"error": str(e)}})

    def _save_states(self):
        """Persist user states to disk."""
        try:
            with self._state_file.open("w", encoding="utf-8") as f:
                json.dump(self._user_states, f, ensure_ascii=False, indent=2)
        except Exception as e:
            logger.warning("telegram_states_save_failed", extra={"context": {"error": str(e)}})

    def get_state(self, chat_id: int) -> dict:
        if chat_id not in self._user_states:
            self._user_states[chat_id] = {"state": STATE_START, "data": {}, "_ts": time.time()}
        return self._user_states[chat_id]

    def set_state(self, chat_id: int, state: str, data: dict | None = None):
        current = self.get_state(chat_id)
        current["state"] = state
        current["_ts"] = time.time()
        if data:
            current["data"].update(data)
        self._save_states()

    # ── Command Handlers ──────────────────────────────────────────────────

    def handle_start(self, chat_id: int, telegram_user_id: str) -> str:
        """Handle /start command. Check if user already exists."""
        session = self._session()
        try:
            existing = (
                session.query(User)
                .filter(User.telegram_user_id == str(telegram_user_id))
                .first()
            )
            if existing:
                if existing.status == "active":
                    return (
                        f"👋 *Welcome back, {existing.full_name}!*\n\n"
                        f"✅ Your account is *active*.\n"
                        f"/my_status — Subscription info\n"
                        f"/my_key — API key"
                    )
                else:
                    return (
                        f"👋 *Welcome back, {existing.full_name}!*\n"
                        f"Status: *{existing.status}*\n"
                        f"Use /register to continue registration."
                    )

            self.set_state(chat_id, STATE_NAME)
            return (
                "🤖 *Welcome to ta-ta Extension!*\n\n"
                "Automate your MCQ exams with our browser extension.\n\n"
                "To get started, use /register\n\n"
                "Already registered? Use /my_status"
            )
        finally:
            session.close()

    def _get_plans_message(self) -> str:
        """Fetch plans and return formatted message. Also stores plan IDs in state."""
        session = self._session()
        try:
            plans = (
                session.query(SubscriptionPlan)
                .filter(SubscriptionPlan.is_active)
                .order_by(SubscriptionPlan.price_amount)
                .all()
            )
            if not plans:
                return "No plans available. Please contact admin."

            msg = "*Select a plan:*\n\n"
            for i, p in enumerate(plans, 1):
                price = f"₹{p.price_amount / 100:.2f}"
                msg += f"*{i}.* *{p.name}* — {price}\n"
                msg += f"   _{p.monthly_limit} solves/mo, {p.duration_days} days_\n\n"
            msg += "_Tap a plan button below to select._"
            return msg
        finally:
            session.close()

    def _build_plan_keyboard(self, chat_id: int):
        """Build an InlineKeyboardMarkup with plan buttons for the given chat."""
        from telegram import InlineKeyboardButton, InlineKeyboardMarkup
        session = self._session()
        try:
            plans = (
                session.query(SubscriptionPlan)
                .filter(SubscriptionPlan.is_active)
                .order_by(SubscriptionPlan.price_amount)
                .all()
            )
            if not plans:
                return None

            buttons = []
            for p in plans:
                price = f"₹{p.price_amount / 100:.2f}"
                label = f"{p.name} — {price}"
                buttons.append([InlineKeyboardButton(
                    label, callback_data=f"plan_{p.id}"
                )])

            # Store plan IDs in state for the callback handler
            self.set_state(chat_id, STATE_PLAN_SELECT, {"plans": [p.id for p in plans]})
            return InlineKeyboardMarkup(buttons)
        finally:
            session.close()

    def handle_name(self, chat_id: int, name: str) -> str:
        self.set_state(chat_id, STATE_MOBILE, {"full_name": name})
        return f"Thanks, *{name}*! Now share your mobile number (e.g., `+919876543210`)."

    def handle_mobile(self, chat_id: int, mobile: str) -> dict:
        """Returns {"text": ..., "inline_keyboard": InlineKeyboardMarkup|None}."""
        mobile = mobile.strip().replace(" ", "")
        self.set_state(chat_id, STATE_PLAN_SELECT, {"mobile_number": mobile})

        session = self._session()
        try:
            plans = (
                session.query(SubscriptionPlan)
                .filter(SubscriptionPlan.is_active)
                .order_by(SubscriptionPlan.price_amount)
                .all()
            )
            if not plans:
                return {"text": "No plans available. Please contact admin.", "inline_keyboard": None}

            self.set_state(chat_id, STATE_PLAN_SELECT, {"plans": [p.id for p in plans]})
            return {
                "text": self._get_plans_message(),
                "inline_keyboard": self._build_plan_keyboard(chat_id),
            }
        finally:
            session.close()

    def handle_plan_select(self, chat_id: int, choice: str) -> dict:
        """Returns {"text": ..., "qr_bytes": BytesIO|None, "inline_keyboard": list|None}
        so caller can send QR image and inline keyboard."""
        state = self.get_state(chat_id)
        try:
            idx = int(choice.strip()) - 1
            plan_ids = state["data"].get("plans", [])
            if idx < 0 or idx >= len(plan_ids):
                return {"text": "Invalid choice. Please reply with a plan number.", "qr_bytes": None, "inline_keyboard": None}
            plan_id = plan_ids[idx]
        except (ValueError, KeyError):
            return {"text": "Please reply with a valid number.", "qr_bytes": None, "inline_keyboard": None}

        session = self._session()
        try:
            plan = session.query(SubscriptionPlan).filter(SubscriptionPlan.id == plan_id).first()
            if not plan:
                return {"text": "Plan not found. Please try again.", "qr_bytes": None, "inline_keyboard": None}

            price = plan.price_amount / 100
            price_str = f"₹{price:.2f}"
            upi = self._upi_id or "Not configured — contact admin"

            # Read dynamic payment settings from DB
            note_prefix = self._read_db_setting("payment.note_prefix") or self._payment_note_prefix
            self._read_db_setting("payment.currency") or self._currency

            # Generate unique payment reference
            ref = f"{note_prefix}{datetime.now(UTC).strftime('%y%m%d')}{uuid.uuid4().hex[:6].upper()}"

            self.set_state(chat_id, STATE_PAYMENT_INSTRUCTIONS, {
                "plan_id": plan_id,
                "plan_name": plan.name,
                "price_amount": plan.price_amount,
                "payment_ref": ref,
                "upi_id": upi,
                "payee_name": self._payee_name,
            })

            # Build UPI intent link dynamically
            upi_link = _make_upi_link(upi, self._payee_name, price, ref)

            msg = (
                f"*Plan:* {plan.name}\n"
                f"*Amount:* {price_str}\n"
                f"*Validity:* {plan.duration_days} days\n"
                f"*Ref:* `{ref}`\n\n"
                f"_Click below to pay using UPI._\n\n"
                f"📋 *Fallback UPI Details:*\n"
                f"• UPI ID: `{upi}`\n"
                f"• Amount: {price_str}\n"
                f"• Note: `{ref}`\n\n"
                f"_After payment, send a *screenshot* of your payment confirmation._"
            )

            # Build inline keyboard with Tap to Pay button
            from telegram import InlineKeyboardButton, InlineKeyboardMarkup
            inline_keyboard = InlineKeyboardMarkup([
                [InlineKeyboardButton("📲 Tap to Pay", url=upi_link)],
            ])

            # Generate QR dynamically from UPI URL
            qr_buf = _generate_qr_bytes(upi_link)
            return {"text": msg, "qr_bytes": qr_buf, "inline_keyboard": inline_keyboard}
        finally:
            session.close()

    def _read_db_setting(self, key: str) -> str | None:
        """Read a platform setting from the database."""
        try:
            from sqlalchemy import text
            session = self._session()
            row = session.execute(
                text("SELECT value FROM platform_settings WHERE key = :key"),
                {"key": key},
            ).fetchone()
            session.close()
            if row and row[0]:
                return row[0]
        except Exception:
            pass
        return None

    def handle_payment_submit(self, chat_id: int, upi_ref: str, telegram_user_id: str) -> str:
        state = self.get_state(chat_id)
        data = state.get("data", {})

        # Validate required data
        if not data.get("full_name") or not data.get("plan_id"):
            logger.error("payment_submit_missing_data", extra={"context": {"data_keys": list(data.keys())}})
            return "Session expired. Please use /register to start over."

        session = self._session()
        try:
            # Check for existing user
            existing = session.query(User).filter(
                User.telegram_user_id == str(telegram_user_id)
            ).first()
            if existing:
                # Update existing user instead of creating duplicate
                existing.full_name = data.get("full_name", existing.full_name)
                existing.mobile_number = data.get("mobile_number", existing.mobile_number)
                existing.status = "pending_payment"
                user = existing
            else:
                user = User(
                    full_name=data.get("full_name", ""),
                    mobile_number=data.get("mobile_number"),
                    telegram_user_id=str(telegram_user_id),
                    telegram_chat_id=str(chat_id),
                    status="pending_payment",
                )
                session.add(user)
                session.flush()

            # Create payment record with all fields
            from datetime import timedelta
            now = datetime.now(UTC)
            payment = PaymentRecord(
                user_id=user.id,
                plan_id=data.get("plan_id"),
                telegram_user_id=str(telegram_user_id),
                payment_method="upi",
                amount=data.get("price_amount", 0),
                payment_ref=data.get("payment_ref", ""),
                upi_id_used=data.get("upi_id", self._upi_id),
                payee_name_used=data.get("payee_name", self._payee_name),
                upi_reference=upi_ref,
                payer_name=data.get("full_name", ""),
                status="pending_payment",
                submitted_at=now,
                expires_at=now + timedelta(hours=24),
            )
            session.add(payment)
            session.commit()

            ref = data.get("payment_ref", upi_ref)
            self.set_state(chat_id, STATE_COMPLETE)
            return (
                f"✅ *Payment Submitted!*\n\n"
                f"• Ref: `{ref}`\n"
                f"• UPI Ref: `{upi_ref}`\n"
                f"• Amount: ₹{data.get('price_amount', 0) / 100:.2f}\n"
                f"• Plan: {data.get('plan_name', 'N/A')}\n\n"
                f"_Pending admin approval. You'll be notified._\n\n"
                f"📋 Commands:\n"
                f"/payment_status — Check status\n"
                f"/my_status — Account info"
            )
        except Exception as e:
            session.rollback()
            logger.error("payment_submit_failed", extra={"context": {
                "error": str(e),
                "type": type(e).__name__,
                "chat_id": chat_id,
            }})
            return "Something went wrong. Please try again or contact admin."
        finally:
            session.close()

    def handle_my_status(self, telegram_user_id: str) -> str:
        session = self._session()
        try:
            user = (
                session.query(User)
                .filter(User.telegram_user_id == str(telegram_user_id))
                .first()
            )
            if not user:
                return "No account found. Use /register to get started."

            sub = (
                session.query(UserSubscription)
                .filter(UserSubscription.user_id == user.id, UserSubscription.status == "active")
                .first()
            )

            # Get API key info
            from app.core.models import UserApiKey
            api_key = (
                session.query(UserApiKey)
                .filter(UserApiKey.user_id == user.id, UserApiKey.status == "active")
                .first()
            )

            # Get latest payment status
            latest_payment = (
                session.query(PaymentRecord)
                .filter(PaymentRecord.user_id == user.id)
                .order_by(PaymentRecord.created_at.desc())
                .first()
            )

            status_emoji = {
                "active": "✅", "pending_payment": "⏳", "blocked": "🚫",
                "inactive": "💤", "expired": "⏰", "deleted": "❌"
            }.get(user.status, "❓")
            status_msg = (
                f"👤 *{user.full_name}*\n"
                f"📱 Mobile: {user.mobile_number or 'N/A'}\n"
                f"🆔 Telegram ID: `{user.telegram_user_id or 'N/A'}`\n"
                f"{status_emoji} Account: *{user.status}*\n"
            )
            if sub:
                plan = session.query(SubscriptionPlan).filter(SubscriptionPlan.id == sub.plan_id).first()
                try:
                    services_raw = json.loads(sub.services_snapshot_json or (plan.services_json if plan else "{}") or "{}")
                except Exception:
                    services_raw = {}
                service_names = [name for name, enabled in services_raw.items() if enabled]
                service_label = ", ".join(service_names) if service_names else "N/A"
                from app.core.models import UsageCycle
                cycle = (
                    session.query(UsageCycle)
                    .filter(UsageCycle.user_id == user.id)
                    .order_by(UsageCycle.cycle_start_at.desc())
                    .first()
                )
                used = cycle.used_count if cycle else 0
                limit = sub.monthly_limit_snapshot or (plan.monthly_limit if plan else 0)
                status_msg += (
                    f"📦 Plan: *{plan.name if plan else 'Unknown'}*\n"
                    f"📅 Expires: {sub.end_at.strftime('%d %b %Y') if sub.end_at else 'N/A'}\n"
                    f"📊 Usage: {used}/{limit} solves\n"
                    f"Services: {service_label}\n"
                )
            else:
                status_msg += (
                    "📦 Plan: *N/A*\n"
                    "📅 Expires: N/A\n"
                    "📊 Usage: N/A\n"
                )

            # API key status
            if api_key:
                status_msg += (
                    f"🔑 API Key: *{api_key.key_prefix_display}* (v{api_key.key_version})\n"
                )
            else:
                status_msg += "🔑 API Key: *Not created yet*\n"

            # Latest payment status
            if latest_payment:
                pay_emoji = {
                    "approved": "✅", "pending_payment": "⏳", "pending": "⏳",
                    "screenshot_submitted": "📸", "ready_for_admin_approval": "👀",
                    "rejected": "❌", "expired": "⏰",
                }.get(latest_payment.status, "❓")
                status_msg += (
                    f"💳 Last Payment: {pay_emoji} *{latest_payment.status}*\n"
                )
            else:
                status_msg += "💳 Last Payment: *None*\n"

            return status_msg
        finally:
            session.close()

    def handle_my_key(self, telegram_user_id: str) -> str:
        """Send key info — never sends plain key via Telegram for security."""
        session = self._session()
        try:
            user = (
                session.query(User)
                .filter(User.telegram_user_id == str(telegram_user_id))
                .first()
            )
            if not user or user.status != "active":
                return "Your account is not active. Complete registration first."

            from app.core.models import UserApiKey
            key = (
                session.query(UserApiKey)
                .filter(UserApiKey.user_id == user.id, UserApiKey.status == "active")
                .first()
            )
            if not key:
                return "No active key. Contact admin to generate one."

            return (
                f"Your API key prefix: {key.key_prefix_display}\n"
                f"Status: {key.status}\n"
                f"Version: {key.key_version}\n\n"
                f"For security, the full key is shown only once at creation.\n"
                f"Use /regenerate_key to get a new key (old key stops working)."
            )
        finally:
            session.close()

    def handle_regenerate_key(self, telegram_user_id: str) -> str:
        """Revoke old key and create a new one."""
        session = self._session()
        try:
            user = (
                session.query(User)
                .filter(User.telegram_user_id == str(telegram_user_id))
                .first()
            )
            if not user or user.status != "active":
                return "Your account is not active. Complete registration first."

            from app.core.config import get_settings
            from app.services.user_key_service import UserKeyService

            svc = UserKeyService(session_factory=self._session_factory, settings=get_settings())
            key, plain = svc.rotate_key(user_id=user.id)

            return (
                f"🔑 *New API Key Generated!*\n\n"
                f"`{plain}`\n\n"
                f"⚠️ *Save this now — it won't be shown again!*\n"
                f"Old keys have been revoked."
            )
        except Exception as e:
            logger.error("regenerate_key_failed", extra={"context": {"error": str(e)}})
            return "Failed to regenerate key. Contact admin."
        finally:
            session.close()

    def _has_pending_payment(self, telegram_user_id: str) -> dict | None:
        """Check if user has a payment that's awaiting admin action.
        Returns the latest pending payment dict, or None if none found.
        """
        session = self._session()
        try:
            user = session.query(User).filter(
                User.telegram_user_id == str(telegram_user_id)
            ).first()
            if not user:
                return None
            payment = (
                session.query(PaymentRecord)
                .filter(
                    PaymentRecord.user_id == user.id,
                    PaymentRecord.status.in_([
                        "pending_payment", "screenshot_submitted",
                        "ready_for_admin_approval",
                    ]),
                )
                .order_by(PaymentRecord.created_at.desc())
                .first()
            )
            if payment:
                return {
                    "id": payment.id,
                    "status": payment.status,
                    "amount": payment.amount,
                    "payment_ref": payment.payment_ref,
                    "plan_id": payment.plan_id,
                    "created_at": payment.created_at,
                }
            return None
        finally:
            session.close()

    def handle_payment_status(self, telegram_user_id: str) -> str:
        session = self._session()
        try:
            user = (
                session.query(User)
                .filter(User.telegram_user_id == str(telegram_user_id))
                .first()
            )
            if not user:
                return "No account found."

            payments = (
                session.query(PaymentRecord)
                .filter(PaymentRecord.user_id == user.id)
                .order_by(PaymentRecord.created_at.desc())
                .limit(3)
                .all()
            )
            if not payments:
                return "No payment records found."

            msg = "💳 *Payment History:*\n\n"
            for p in payments:
                emoji = {
                    "approved": "✅", "pending_payment": "⏳", "pending": "⏳",
                    "screenshot_submitted": "📸", "ready_for_admin_approval": "👀",
                    "ocr_matched": "🔍", "ocr_mismatch": "⚠️",
                    "rejected": "❌", "expired": "⏰",
                }.get(p.status, "❓")
                msg += (
                    f"{emoji} #{p.id}: ₹{p.amount/100:.2f} — *{p.status}*\n"
                    f"   Ref: `{p.payment_ref or 'N/A'}`\n"
                    f"   {p.created_at.strftime('%d %b %Y') if p.created_at else '?'}\n\n"
                )
            return msg
        finally:
            session.close()

    def notify_user(self, telegram_user_id: str, message: str) -> bool:
        """Send a notification message to a user via Telegram.
        Returns True if message was sent successfully.
        Note: This requires the bot to be running (polling). If called from
        a different process, it may not work. For cross-process notifications,
        use a message queue or HTTP callback.
        """
        try:
            # Find chat_id for the user
            session = self._session()
            try:
                user = session.query(User).filter(
                    User.telegram_user_id == str(telegram_user_id)
                ).first()
                if not user or not user.telegram_chat_id:
                    return False
                chat_id = int(user.telegram_chat_id)
            finally:
                session.close()

            # Send message using python-telegram-bot
            from telegram import Bot
            bot = Bot(token=self._token)
            import asyncio
            try:
                loop = asyncio.get_event_loop()
                if loop.is_running():
                    # We're inside an event loop, create a task
                    asyncio.ensure_future(bot.send_message(
                        chat_id=chat_id, text=message, parse_mode="Markdown"))
                else:
                    loop.run_until_complete(bot.send_message(
                        chat_id=chat_id, text=message, parse_mode="Markdown"))
            except RuntimeError:
                asyncio.run(bot.send_message(
                    chat_id=chat_id, text=message, parse_mode="Markdown"))
            return True
        except Exception as e:
            logger.error("notify_user_failed", extra={"context": {
                "telegram_user_id": telegram_user_id, "error": str(e)
            }})
            return False

    def run(self):
        """Start the bot using long-polling."""
        try:
            from telegram import KeyboardButton, ReplyKeyboardMarkup, Update
            from telegram.ext import (
                Application,
                CallbackQueryHandler,
                CommandHandler,
                ContextTypes,
                MessageHandler,
                filters,
            )

            app = Application.builder().token(self._token).build()

            def _main_keyboard():
                """Return the main menu keyboard."""
                return ReplyKeyboardMarkup(
                    [
                        [KeyboardButton("📝 Register"), KeyboardButton("📊 My Status")],
                        [KeyboardButton("💳 Payments"), KeyboardButton("🔑 My Key")],
                        [KeyboardButton("🔄 New Key"), KeyboardButton("❓ Help")],
                    ],
                    resize_keyboard=True,
                )

            async def start_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
                uid = str(update.effective_user.id)
                chat_id = update.effective_chat.id
                msg = self.handle_start(chat_id, uid)
                # Only show keyboard for existing users (not during registration)
                state = self.get_state(chat_id)
                kwargs = {"parse_mode": "Markdown"}
                if state["state"] != STATE_NAME:
                    kwargs["reply_markup"] = _main_keyboard()
                await update.message.reply_text(msg, **kwargs)

            async def status_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
                uid = str(update.effective_user.id)
                msg = self.handle_my_status(uid)
                await update.message.reply_text(msg, parse_mode="Markdown")

            async def key_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
                uid = str(update.effective_user.id)
                msg = self.handle_my_key(uid)
                await update.message.reply_text(msg)

            async def regenerate_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
                uid = str(update.effective_user.id)
                msg = self.handle_regenerate_key(uid)
                await update.message.reply_text(msg, parse_mode="Markdown")

            async def payment_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
                uid = str(update.effective_user.id)
                msg = self.handle_payment_status(uid)
                await update.message.reply_text(msg, parse_mode="Markdown")

            async def register_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
                uid = str(update.effective_user.id)
                chat_id = update.effective_chat.id

                # Check if user has a pending payment — block re-registration
                pending = self._has_pending_payment(uid)
                if pending:
                    status_labels = {
                        "pending_payment": "Awaiting payment",
                        "screenshot_submitted": "Screenshot submitted",
                        "ready_for_admin_approval": "Under admin review",
                    }
                    label = status_labels.get(pending["status"], pending["status"])
                    await update.message.reply_text(
                        f"⏳ *Payment Already in Progress*\n\n"
                        f"• Ref: `{pending['payment_ref'] or 'N/A'}`\n"
                        f"• Amount: ₹{pending['amount'] / 100:.2f}\n"
                        f"• Status: *{label}*\n\n"
                        f"_Please wait for admin approval. No need to register again._\n\n"
                        f"Use /payment_status to check updates.",
                        parse_mode="Markdown", reply_markup=_main_keyboard())
                    return

                # Check if user already exists — single account per TG user
                session = self._session()
                try:
                    existing = session.query(User).filter(
                        User.telegram_user_id == uid
                    ).first()
                    if existing:
                        # Existing user — skip name/mobile, go directly to plans
                        self.set_state(chat_id, STATE_PLAN_SELECT, {
                            "full_name": existing.full_name,
                            "mobile_number": existing.mobile_number,
                        })
                        if existing.status == "active":
                            msg = (
                                f"👋 *Welcome back, {existing.full_name}!*\n\n"
                                f"Your account is active. Select a plan to upgrade or renew:\n\n"
                            ) + self._get_plans_message()
                        else:
                            msg = self._get_plans_message()
                        keyboard = self._build_plan_keyboard(chat_id)
                        kwargs = {"parse_mode": "Markdown"}
                        if keyboard:
                            kwargs["reply_markup"] = keyboard
                        await update.message.reply_text(msg, **kwargs)
                        return
                finally:
                    session.close()

                # New user — start name collection (asked only once)
                self.set_state(chat_id, STATE_NAME)
                await update.message.reply_text(
                    "Let's register! What's your full name?",
                    parse_mode="Markdown")

            async def text_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
                chat_id = update.effective_chat.id
                text = update.message.text.strip()
                state = self.get_state(chat_id)
                uid = str(update.effective_user.id)

                # ── Handle keyboard button presses ──────────────────────────
                if text == "📝 Register":
                    # Check for pending payment first
                    pending = self._has_pending_payment(uid)
                    if pending:
                        status_labels = {
                            "pending_payment": "Awaiting payment",
                            "screenshot_submitted": "Screenshot submitted",
                            "ready_for_admin_approval": "Under admin review",
                        }
                        label = status_labels.get(pending["status"], pending["status"])
                        await update.message.reply_text(
                            f"⏳ *Payment Already in Progress*\n\n"
                            f"• Ref: `{pending['payment_ref'] or 'N/A'}`\n"
                            f"• Amount: ₹{pending['amount'] / 100:.2f}\n"
                            f"• Status: *{label}*\n\n"
                            f"_Please wait for admin approval._\n"
                            f"Use /payment_status to check updates.",
                            parse_mode="Markdown", reply_markup=_main_keyboard())
                        return
                    self.set_state(chat_id, STATE_NAME)
                    await update.message.reply_text(
                        "Let's register! What's your full name?", parse_mode="Markdown")
                    return
                if text == "📊 My Status":
                    msg = self.handle_my_status(uid)
                    await update.message.reply_text(msg)
                    return
                if text == "💳 Payments":
                    msg = self.handle_payment_status(uid)
                    await update.message.reply_text(msg)
                    return
                if text == "🔑 My Key":
                    msg = self.handle_my_key(uid)
                    await update.message.reply_text(msg)
                    return
                if text == "🔄 New Key":
                    msg = self.handle_regenerate_key(uid)
                    await update.message.reply_text(msg)
                    return
                if text == "❓ Help":
                    await update.message.reply_text(
                        "🤖 *ta-ta Extension Bot*\n\n"
                        "📋 *Commands:*\n"
                        "/start — Welcome & info\n"
                        "/register — Start registration\n"
                        "/my_status — Your account status\n"
                        "/payment_status — Payment history\n"
                        "/my_key — API key info\n"
                        "/help — This help",
                        parse_mode="Markdown", reply_markup=_main_keyboard())
                    return

                # ── State machine ───────────────────────────────────────────
                qr_bytes = None
                inline_keyboard = None
                in_registration = state["state"] in (STATE_NAME, STATE_MOBILE,
                    STATE_PLAN_SELECT, STATE_PAYMENT_INSTRUCTIONS)

                try:
                    if state["state"] == STATE_NAME:
                        reply = self.handle_name(chat_id, text)
                    elif state["state"] == STATE_MOBILE:
                        result = self.handle_mobile(chat_id, text)
                        reply = result["text"]
                        inline_keyboard = result.get("inline_keyboard")
                    elif state["state"] == STATE_PLAN_SELECT:
                        result = self.handle_plan_select(chat_id, text)
                        reply = result["text"]
                        qr_bytes = result.get("qr_bytes")
                        inline_keyboard = result.get("inline_keyboard")
                    elif state["state"] == STATE_PAYMENT_INSTRUCTIONS:
                        # User sent text — check if it looks like a UPI reference
                        import re as _re
                        upi_ref_match = _re.match(r'^[A-Za-z0-9]{8,30}$', text.strip())
                        if upi_ref_match:
                            reply = self.handle_payment_submit(chat_id, text.strip(), uid)
                        else:
                            reply = (
                                "📸 *Please send a screenshot* of your payment confirmation.\n\n"
                                "The screenshot should clearly show the transaction/reference ID.\n\n"
                                "_Tap the 📎 attachment button to send a photo._\n\n"
                                "_Or paste your UPI transaction reference ID as text._"
                            )
                    else:
                        reply = "Use /register to start or /help for commands."
                except Exception as e:
                    logger.error("text_handler_error", extra={"context": {
                        "error": str(e), "state": state.get("state"), "chat_id": chat_id
                    }})
                    reply = "Something went wrong. Please use /register to start over."

                # Send reply — use keyboard only outside registration flow
                kwargs = {"parse_mode": "Markdown"}
                if not in_registration:
                    kwargs["reply_markup"] = _main_keyboard()
                if inline_keyboard:
                    kwargs["reply_markup"] = inline_keyboard
                await update.message.reply_text(reply, **kwargs)

                # Send QR photo if available
                if qr_bytes:
                    try:
                        await update.message.reply_photo(
                            qr_bytes, caption="📱 Scan this QR to pay via any UPI app")
                    except Exception as e:
                        logger.error("qr_photo_failed", extra={"context": {"error": str(e)}})

            async def help_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
                await update.message.reply_text(
                    "🤖 *ta-ta Extension Bot*\n\n"
                    "📋 *Commands:*\n"
                    "/start — Welcome & info\n"
                    "/register — Start registration\n"
                    "/my_status — Your account status\n"
                    "/payment_status — Payment history\n"
                    "/my_key — API key info\n"
                    "/help — This help",
                    parse_mode="Markdown",
                    reply_markup=_main_keyboard()
                )

            async def plan_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
                """Handle inline keyboard plan selection callbacks."""
                query = update.callback_query
                await query.answer()
                chat_id = update.effective_chat.id

                data = query.data
                if not data or not data.startswith("plan_"):
                    return

                try:
                    plan_id = int(data.split("_", 1)[1])
                except (ValueError, IndexError):
                    await query.edit_message_text("Invalid plan selection. Use /register to try again.")
                    return

                # Check if user has a pending payment
                uid = str(update.effective_user.id)
                pending = self._has_pending_payment(uid)
                if pending:
                    await query.edit_message_text(
                        "⏳ *Payment Already in Progress*\n\n"
                        "Your payment is already being processed. Use /payment_status to check.",
                        parse_mode="Markdown")
                    return

                # Process plan selection
                self.handle_plan_select(chat_id, str(plan_id + 1))  # Convert back to 1-based for compatibility
                # Actually, handle_plan_select expects a 1-based index. Let's fix this.
                # We need to look up the plan by ID directly.

                session = self._session()
                try:
                    plan = session.query(SubscriptionPlan).filter(SubscriptionPlan.id == plan_id).first()
                    if not plan:
                        await query.edit_message_text("Plan not found. Please try again.")
                        return

                    price = plan.price_amount / 100
                    price_str = f"₹{price:.2f}"
                    upi = self._upi_id or "Not configured — contact admin"

                    note_prefix = self._read_db_setting("payment.note_prefix") or self._payment_note_prefix
                    ref = f"{note_prefix}{datetime.now(UTC).strftime('%y%m%d')}{uuid.uuid4().hex[:6].upper()}"

                    self.set_state(chat_id, STATE_PAYMENT_INSTRUCTIONS, {
                        "plan_id": plan_id,
                        "plan_name": plan.name,
                        "price_amount": plan.price_amount,
                        "payment_ref": ref,
                        "upi_id": upi,
                        "payee_name": self._payee_name,
                    })

                    upi_link = _make_upi_link(upi, self._payee_name, price, ref)

                    msg = (
                        f"*Plan:* {plan.name}\n"
                        f"*Amount:* {price_str}\n"
                        f"*Validity:* {plan.duration_days} days\n"
                        f"*Ref:* `{ref}`\n\n"
                        f"_Click below to pay using UPI._\n\n"
                        f"📋 *Fallback UPI Details:*\n"
                        f"• UPI ID: `{upi}`\n"
                        f"• Amount: {price_str}\n"
                        f"• Note: `{ref}`\n\n"
                        f"_After payment, send a *screenshot* of your payment confirmation._"
                    )

                    from telegram import InlineKeyboardButton, InlineKeyboardMarkup
                    pay_keyboard = InlineKeyboardMarkup([
                        [InlineKeyboardButton("📲 Tap to Pay", url=upi_link)],
                    ])

                    # Edit the plan selection message to show payment instructions
                    await query.edit_message_text(msg, parse_mode="Markdown", reply_markup=pay_keyboard)

                    # Send QR code
                    qr_buf = _generate_qr_bytes(upi_link)
                    try:
                        await context.bot.send_photo(
                            chat_id=chat_id,
                            photo=qr_buf,
                            caption="📱 Scan this QR to pay via any UPI app"
                        )
                    except Exception as e:
                        logger.error("qr_photo_failed", extra={"context": {"error": str(e)}})
                finally:
                    session.close()

            async def photo_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
                """Handle payment screenshot uploads."""
                chat_id = update.effective_chat.id
                state = self.get_state(chat_id)
                uid = str(update.effective_user.id)

                if state["state"] != STATE_PAYMENT_INSTRUCTIONS:
                    await update.message.reply_text(
                        "Send screenshot after selecting a plan and making payment.",
                        reply_markup=_main_keyboard())
                    return

                # Download the photo
                photo = update.message.photo[-1]  # highest resolution
                file = await context.bot.get_file(photo.file_id)

                # Save to disk
                upload_dir = Path(__file__).resolve().parents[3] / "data" / "payment_screenshots"
                upload_dir.mkdir(parents=True, exist_ok=True)
                filename = f"pay_{uid}_{datetime.now(UTC).strftime('%Y%m%d_%H%M%S')}.jpg"
                filepath = upload_dir / filename
                await file.download_to_drive(str(filepath))

                # Try OCR to extract reference ID, amount, date, payer
                import asyncio as _asyncio
                ocr_data = await _asyncio.to_thread(self._ocr_screenshot_full, filepath)

                # Compare extracted ref with expected payment_ref
                expected_ref = state["data"].get("payment_ref", "")
                ocr_matched = False
                extracted_ref = ocr_data.get("ref")
                if extracted_ref and expected_ref:
                    # Normalize both for comparison (strip spaces, uppercase)
                    extracted_clean = extracted_ref.strip().upper().replace(" ", "")
                    expected_clean = expected_ref.strip().upper().replace(" ", "")
                    # Match if extracted contains expected OR expected contains extracted
                    ocr_matched = (
                        expected_clean in extracted_clean
                        or extracted_clean in expected_clean
                    )

                # Determine new status based on OCR result
                if ocr_matched:
                    new_status = "ready_for_admin_approval"
                else:
                    new_status = "screenshot_submitted"

                # Save to DB — look up existing payment by ref, or create new
                session = self._session()
                try:
                    user = session.query(User).filter(
                        User.telegram_user_id == uid
                    ).first()
                    if user:
                        # Try to find existing payment record by payment_ref
                        existing_payment = None
                        if expected_ref:
                            existing_payment = session.query(PaymentRecord).filter(
                                PaymentRecord.payment_ref == expected_ref,
                                PaymentRecord.user_id == user.id,
                            ).first()

                        if existing_payment:
                            # Update existing payment with screenshot + OCR data
                            existing_payment.payment_screenshot_path = str(filepath)
                            existing_payment.ocr_matched = ocr_matched
                            existing_payment.ocr_extracted_ref = extracted_ref
                            existing_payment.ocr_extracted_amount = ocr_data.get("amount")
                            existing_payment.ocr_extracted_date = ocr_data.get("date")
                            existing_payment.ocr_extracted_payer = ocr_data.get("payer")
                            existing_payment.upi_reference = extracted_ref or existing_payment.upi_reference
                            existing_payment.status = new_status
                            existing_payment.updated_at = datetime.now(UTC)
                            session.commit()
                            payment = existing_payment
                        else:
                            # No existing payment — create new record
                            payment = PaymentRecord(
                                user_id=user.id,
                                plan_id=state["data"].get("plan_id"),
                                telegram_user_id=uid,
                                payment_method="upi",
                                amount=state["data"].get("price_amount", 0),
                                payment_ref=expected_ref,
                                upi_id_used=state["data"].get("upi_id", self._upi_id),
                                payee_name_used=state["data"].get("payee_name", self._payee_name),
                                upi_reference=extracted_ref or "screenshot_submitted",
                                payer_name=state["data"].get("full_name", user.full_name),
                                payment_screenshot_path=str(filepath),
                                ocr_matched=ocr_matched,
                                ocr_extracted_ref=extracted_ref,
                                ocr_extracted_amount=ocr_data.get("amount"),
                                ocr_extracted_date=ocr_data.get("date"),
                                ocr_extracted_payer=ocr_data.get("payer"),
                                status=new_status,
                                submitted_at=datetime.now(UTC),
                            )
                            session.add(payment)
                            session.commit()

                        ref = expected_ref or "N/A"
                        if ocr_matched:
                            reply = (
                                f"📸 *Screenshot received & verified!*\n\n"
                                f"• Ref: `{ref}`\n"
                                f"• Detected UPI Ref: `{extracted_ref}`\n"
                                f"• ✅ *Match confirmed*\n\n"
                                f"_Payment submitted for approval. Please wait 1-2 hours._"
                            )
                        else:
                            reply = (
                                f"📸 *Screenshot received!*\n\n"
                                f"• Ref: `{ref}`\n"
                                f"• Detected UPI Ref: `{extracted_ref or 'not detected'}`\n"
                                f"• ⚠️ *Could not verify match automatically*\n"
                                f"  _Admin will manually verify._\n\n"
                                f"_Payment submitted for approval. Please wait 1-2 hours._"
                            )
                    else:
                        reply = "Account not found. Use /register first."
                except Exception as e:
                    session.rollback()
                    logger.error("screenshot_submit_failed", extra={"context": {"error": str(e)}})
                    reply = "Failed to process screenshot. Please try again."
                finally:
                    session.close()

                self.set_state(chat_id, STATE_COMPLETE)
                await update.message.reply_text(reply, parse_mode="Markdown",
                    reply_markup=_main_keyboard())

            def _ocr_screenshot_full(self, filepath: Path) -> dict:
                """Try OCR on screenshot to extract UPI reference ID, amount, date, payer."""
                result = {"ref": None, "amount": None, "date": None, "payer": None}
                try:
                    from PIL import Image
                    img = Image.open(filepath)
                    try:
                        import re

                        import pytesseract
                        text = pytesseract.image_to_string(img)
                        # UPI ref patterns
                        ref_patterns = [
                            r'(?:Ref|UTR|Reference|Transaction\s*ID)[:\s]*([A-Z0-9]{8,20})',
                            r'\b(\d{12})\b',
                        ]
                        for pat in ref_patterns:
                            m = re.search(pat, text, re.IGNORECASE)
                            if m:
                                result["ref"] = m.group(1)
                                break
                        # Amount pattern (₹ or INR)
                        amt_match = re.search(r'(?:₹|INR|Rs\.?)\s*([\d,]+\.?\d{0,2})', text, re.IGNORECASE)
                        if amt_match:
                            result["amount"] = amt_match.group(0).strip()
                        # Date/time patterns
                        date_match = re.search(r'(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4})', text, re.IGNORECASE)
                        if not date_match:
                            date_match = re.search(r'(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})', text)
                        if date_match:
                            result["date"] = date_match.group(1)
                        # Payer name (near "Paid to" or "From")
                        payer_match = re.search(r'(?:Paid\s*(?:to|by)|From|Sender)[:\s]*([A-Za-z\s]{3,30})', text, re.IGNORECASE)
                        if payer_match:
                            result["payer"] = payer_match.group(1).strip()
                    except ImportError:
                        pass
                except Exception as e:
                    logger.error("ocr_failed", extra={"context": {"error": str(e)}})
                return result

            app.add_handler(CommandHandler("start", start_cmd))
            app.add_handler(CommandHandler("register", register_cmd))
            app.add_handler(CommandHandler("my_status", status_cmd))
            app.add_handler(CommandHandler("my_key", key_cmd))
            app.add_handler(CommandHandler("regenerate_key", regenerate_cmd))
            app.add_handler(CommandHandler("payment_status", payment_cmd))
            app.add_handler(CommandHandler("help", help_cmd))
            app.add_handler(CallbackQueryHandler(plan_callback, pattern="^plan_"))
            app.add_handler(MessageHandler(filters.PHOTO, photo_handler))
            app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, text_handler))

            logger.info("telegram_bot_starting")
            # stop_signals=None required when running in background thread
            app.run_polling(stop_signals=None)
        except ImportError:
            logger.error("python-telegram-bot not installed — Telegram bot disabled")
        except Exception as e:
            logger.error("telegram_bot_failed", extra={"context": {"error": str(e)}})


# Helper to read a setting: env var → config → DB
def _read_setting(env_key: str, config_val: str, db_key: str, session_factory) -> str:
    import os
    val = os.getenv(env_key, "") or config_val
    if not val:
        try:
            from sqlalchemy import text
            session = session_factory()
            row = session.execute(
                text("SELECT value FROM platform_settings WHERE key = :key"), {"key": db_key}
            ).fetchone()
            session.close()
            if row and row[0]:
                val = row[0]
        except Exception:
            pass
    return val


def _read_payment_settings(settings, session_factory) -> dict:
    settings_payment = getattr(settings, "payment", None)
    return {
        "upi_id": _read_setting("", getattr(settings_payment, "upi_id", ""), "payment.upi_id", session_factory),
        "qr_image_url": _read_setting("", getattr(settings_payment, "qr_image_url", ""), "payment.qr_image_url", session_factory),
        "payee_name": _read_setting("", "ta-ta Extension", "payment.payee_name", session_factory),
        "payment_note_prefix": _read_setting("", "Reg", "payment.note_prefix", session_factory),
    }


def _build_bot(settings, session_factory, token: str) -> TelegramBotService:
    payment_settings = _read_payment_settings(settings, session_factory)
    return TelegramBotService(
        token=token,
        session_factory=session_factory,
        upi_id=payment_settings["upi_id"],
        qr_image_url=payment_settings["qr_image_url"],
        payee_name=payment_settings["payee_name"],
        payment_note_prefix=payment_settings["payment_note_prefix"],
    )


def _run_standalone() -> None:
    import os
    import sys

    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../.."))

    from app.core.config import get_settings
    from app.core.db import get_session, init_db

    settings = get_settings()
    init_db(settings)

    wait_for_token = os.getenv("TELEGRAM_BOT_WAIT_FOR_TOKEN", "true").lower() in {"1", "true", "yes", "on"}
    poll_seconds = max(5, int(os.getenv("TELEGRAM_BOT_TOKEN_POLL_SECONDS", "15") or "15"))

    while True:
        token = _read_setting("TELEGRAM_BOT_TOKEN", settings.telegram.bot_token, "telegram.bot_token", get_session)
        if token:
            print(f"Bot starting with token: {token[:10]}...")
            _build_bot(settings, get_session, token).run()
            return

        if not wait_for_token:
            print("TELEGRAM_BOT_TOKEN not set and telegram.bot_token is empty - exiting")
            sys.exit(1)

        print(f"Telegram bot token not configured yet - waiting {poll_seconds}s")
        time.sleep(poll_seconds)


# Entry point for standalone process
if False and __name__ == "__main__":
    import os
    import sys
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../.."))

    from app.core.config import get_settings
    from app.core.db import get_session, init_db

    settings = get_settings()
    init_db(settings)

    token = _read_setting("TELEGRAM_BOT_TOKEN", settings.telegram.bot_token, "telegram.bot_token", get_session)
    if not token:
        print("TELEGRAM_BOT_TOKEN not set — exiting")
        sys.exit(1)

    upi_id = _read_setting("", settings.payment.upi_id, "payment.upi_id", get_session)
    qr_url = _read_setting("", settings.payment.qr_image_url, "payment.qr_image_url", get_session)
    payee_name = _read_setting("", "ta-ta Extension", "payment.payee_name", get_session)
    note_prefix = _read_setting("", "Reg", "payment.note_prefix", get_session)

    print(f"Bot starting with token: {token[:10]}...")
    bot = TelegramBotService(
        token=token,
        session_factory=get_session,
        upi_id=upi_id,
        qr_image_url=qr_url,
        payee_name=payee_name,
        payment_note_prefix=note_prefix,
    )
    bot.run()


def start_bot(settings=None, session_factory=None) -> TelegramBotService | None:
    """Start the Telegram bot in a background thread. Called from server startup.
    Reads token from env var first, then config, then DB platform setting.
    """
    import os
    import threading

    from sqlalchemy import text
    token = os.getenv("TELEGRAM_BOT_TOKEN", "")
    if not token and settings:
        token = settings.telegram.bot_token
    if not token and session_factory:
        try:
            session = session_factory()
            row = session.execute(
                text("SELECT value FROM platform_settings WHERE key = :key"),
                {"key": "telegram.bot_token"},
            ).fetchone()
            session.close()
            if row and row[0]:
                token = row[0]
        except Exception:
            pass
    if not token:
        logger.info("Telegram bot token not configured — bot disabled")
        return None

    logger.info("Starting Telegram bot in background...")
    bot = _build_bot(settings, session_factory or get_session, token)
    t = threading.Thread(target=bot.run, daemon=True, name="telegram-bot")
    t.start()
    return bot


if __name__ == "__main__":
    _run_standalone()
