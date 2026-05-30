"""Telegram bot service — registration, plan selection, payment submission.

Uses python-telegram-bot for long-polling. Connects to the same database.
Run as a separate process: python -m app.services.telegram_bot
"""

from __future__ import annotations

import io
import json
import logging
import os
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

import qrcode
from app.core.models import User, SubscriptionPlan, PaymentRecord, UserSubscription
from app.core.config import get_settings, require_runtime_auth
from app.core.db import get_session
from app.core.payment_links import build_upi_link
from app.services.admin_notification_service import AdminNotificationService
from app.services.audit_service import AuditService

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


def _find_plan_qr_image(plan_id: int) -> Path | None:
    """Find an uploaded QR code image file for a specific plan."""
    for ext in ("png", "jpg", "jpeg", "gif", "webp"):
        fp = _QR_DIR / f"qr_plan_{int(plan_id)}.{ext}"
        if fp.exists():
            return fp
    return None


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
        self._audit_service = AuditService(self._session_factory)
        self._admin_notifications = AdminNotificationService(self._session_factory)

        # Persist user states to survive bot restarts
        import os as _os
        _data_dir = Path(__file__).resolve().parents[3] / "data"
        _data_dir.mkdir(parents=True, exist_ok=True)
        self._state_file = _data_dir / "telegram_user_states.json"
        self._load_states()

    def _session(self):
        return self._session_factory()

    def _safe_audit_log(self, **kwargs):
        try:
            self._audit_service.log(**kwargs)
        except Exception as exc:
            logger.warning("telegram_audit_log_failed", extra={"context": {
                "action": kwargs.get("action"),
                "error": str(exc),
            }})

    def _notify_payment_in_background(self, payment_id: int, event_type: str):
        def _send():
            self._admin_notifications.notify_payment(payment_id, event_type)

        try:
            import threading
            threading.Thread(target=_send, daemon=True).start()
        except Exception as exc:
            logger.warning("telegram_payment_notify_dispatch_failed", extra={"context": {
                "event_type": event_type,
                "payment_id": payment_id,
                "error": str(exc),
            }})

    def _public_base_url(self) -> str:
        raw = (
            self._read_db_setting("server.public_base_url")
            or os.getenv("PUBLIC_BASE_URL", "")
            or ""
        ).strip()
        if not raw:
            return ""
        if raw.startswith("http://") or raw.startswith("https://"):
            return raw.rstrip("/")
        return f"https://{raw}".rstrip("/")

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
            self._state_file.parent.mkdir(parents=True, exist_ok=True)
            tmp_file = self._state_file.with_suffix(f"{self._state_file.suffix}.tmp")
            with tmp_file.open("w", encoding="utf-8") as f:
                json.dump(self._user_states, f, ensure_ascii=False, indent=2)
            tmp_file.replace(self._state_file)
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
                "👋 *Welcome to ta-ta Extensions*\n\n"
                "Use this bot to register your account, choose a plan, submit payment proof, "
                "and check your subscription after approval.\n\n"
                "Tap *Register* to begin, or send your full name here to start registration.\n"
                "Tap *Help* if you want the command guide first."
            )
        finally:
            session.close()

    def _get_plans_message(self) -> str:
        """Fetch plans and return formatted message. Also stores plan IDs in state."""
        session = self._session()
        try:
            plans = (
                session.query(SubscriptionPlan)
                .filter(SubscriptionPlan.is_active == True)
                .filter(SubscriptionPlan.show_in_bot == True)
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
                .filter(SubscriptionPlan.is_active == True)
                .filter(SubscriptionPlan.show_in_bot == True)
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

    def handle_mobile(self, chat_id: int, mobile: str, telegram_user_id: str | None = None) -> dict:
        """Returns {"text": ..., "inline_keyboard": InlineKeyboardMarkup|None}."""
        mobile = mobile.strip().replace(" ", "")

        session = self._session()
        try:
            existing_mobile_user = (
                session.query(User)
                .filter(User.mobile_number == mobile)
                .first()
            )
            if existing_mobile_user and (
                not telegram_user_id
                or str(existing_mobile_user.telegram_user_id or "") != str(telegram_user_id)
            ):
                return {
                    "text": (
                        "❌ This mobile number is already registered.\n"
                        "Use your existing account or contact admin support."
                    ),
                    "inline_keyboard": None,
                }

            self.set_state(chat_id, STATE_PLAN_SELECT, {"mobile_number": mobile})
            plans = (
                session.query(SubscriptionPlan)
                .filter(SubscriptionPlan.is_active == True)
                .filter(SubscriptionPlan.show_in_bot == True)
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

        return self.handle_plan_select_by_id(chat_id, plan_id)

    def _resolve_plan_qr_source(self, plan_id: int) -> str:
        """Resolve fixed QR image source for a plan.

        Priority:
        1) payment.qr_image_url_plan_<plan_id>
        2) payment.plan_qr_map (JSON object keyed by plan id)
        3) payment.qr_image_url
        """
        direct_key = self._read_db_setting(f"payment.qr_image_url_plan_{int(plan_id)}")
        if direct_key:
            return direct_key.strip()

        raw_map = self._read_db_setting("payment.plan_qr_map")
        if raw_map:
            try:
                parsed = json.loads(raw_map)
                mapped = (parsed or {}).get(str(plan_id))
                if isinstance(mapped, str) and mapped.strip():
                    return mapped.strip()
            except Exception:
                pass

        fallback = self._read_db_setting("payment.qr_image_url") or self._qr_image_url
        return (fallback or "").strip()

    def handle_plan_select_by_id(self, chat_id: int, plan_id: int) -> dict:
        """Build payment instructions for an exact plan id from inline callbacks."""
        session = self._session()
        try:
            plan = (
                session.query(SubscriptionPlan)
                .filter(SubscriptionPlan.id == plan_id)
                .filter(SubscriptionPlan.is_active == True)
                .filter(SubscriptionPlan.show_in_bot == True)
                .first()
            )
            if not plan:
                return {"text": "Plan not found. Please try again.", "qr_bytes": None, "qr_url": "", "qr_path": None, "inline_keyboard": None}

            price = plan.price_amount / 100
            price_str = f"₹{price:.2f}"

            # Read dynamic payment settings from DB
            upi = self._read_db_setting("payment.upi_id") or self._upi_id or "Not configured — contact admin"
            payee_name = self._read_db_setting("payment.payee_name") or self._payee_name
            note_prefix = self._read_db_setting("payment.note_prefix") or self._payment_note_prefix
            currency = self._read_db_setting("payment.currency") or self._currency

            # Generate unique payment reference
            ref = f"{note_prefix}{datetime.now(timezone.utc).strftime('%y%m%d')}{uuid.uuid4().hex[:6].upper()}"

            self.set_state(chat_id, STATE_PAYMENT_INSTRUCTIONS, {
                "plan_id": plan_id,
                "plan_name": plan.name,
                "price_amount": plan.price_amount,
                "payment_ref": ref,
                "upi_id": upi,
                "payee_name": payee_name,
            })

            # Build UPI intent link for fallback generated QR (when no fixed QR is configured)
            upi_link = build_upi_link(upi, payee_name, price, ref, currency)
            plan_qr_source = self._resolve_plan_qr_source(plan_id)
            has_fixed_qr = plan_qr_source.startswith("http://") or plan_qr_source.startswith("https://")
            inline_keyboard = None
            qr_buf = None
            qr_url = ""
            qr_path = _find_plan_qr_image(plan_id)
            has_qr = bool(qr_path) or has_fixed_qr
            pay_line = "_Scan the plan QR below and complete payment._" if has_qr else "_Scan the QR below or use UPI details manually._"
            msg = (
                f"*Plan:* {plan.name}\n"
                f"*Amount:* {price_str}\n"
                f"*Validity:* {plan.duration_days} days\n"
                f"*Ref:* `{ref}`\n\n"
                f"{pay_line}\n\n"
            )
            if not has_qr:
                msg += (
                    f"📋 *Fallback UPI Details:*\n"
                    f"• UPI ID: `{upi}`\n"
                    f"• Payee: `{payee_name}`\n"
                    f"• Amount: {price_str}\n"
                    f"• Note: `{ref}`\n\n"
                )
            msg += (
                f"_After payment, send a *screenshot* of your payment confirmation._\n"
                f"_We will verify it within 1-2 hours and activate your account._"
            )
            if qr_path:
                pass
            elif has_fixed_qr:
                qr_url = plan_qr_source
            else:
                # Fallback to generated QR if fixed plan QR is not configured yet.
                qr_buf = _generate_qr_bytes(upi_link)
            return {"text": msg, "qr_bytes": qr_buf, "qr_url": qr_url, "qr_path": qr_path, "inline_keyboard": inline_keyboard}
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
            created_user = False
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
                created_user = True

            # Create payment record with all fields
            from datetime import timedelta
            now = datetime.now(timezone.utc)
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
            payment_id = payment.id
            user_id = user.id
            plan_id = data.get("plan_id")

            if created_user:
                self._safe_audit_log(
                    actor_type="bot",
                    action="telegram_user_created",
                    actor_id=user_id,
                    target_type="user",
                    target_id=user_id,
                    after_json=json.dumps({
                        "telegram_user_id": str(telegram_user_id),
                        "telegram_chat_id": str(chat_id),
                        "mobile_number": data.get("mobile_number"),
                    }),
                )
            self._safe_audit_log(
                actor_type="bot",
                action="telegram_payment_created",
                actor_id=user_id,
                target_type="payment",
                target_id=payment_id,
                after_json=json.dumps({
                    "payment_ref": data.get("payment_ref", ""),
                    "upi_reference": upi_ref,
                    "plan_id": plan_id,
                    "amount": data.get("price_amount", 0),
                    "status": "pending_payment",
                }),
            )

            ref = data.get("payment_ref", upi_ref)
            self.set_state(chat_id, STATE_COMPLETE)
            return (
                f"✅ *Payment Submitted!*\n\n"
                f"• Ref: `{ref}`\n"
                f"• UPI Ref: `{upi_ref}`\n"
                f"• Amount: ₹{data.get('price_amount', 0) / 100:.2f}\n"
                f"• Plan: {data.get('plan_name', 'N/A')}\n\n"
                f"_Pending admin approval. You'll be notified._"
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
                from app.core.models import UsageCycle
                cycle = (
                    session.query(UsageCycle)
                    .filter(UsageCycle.user_id == user.id)
                    .order_by(UsageCycle.cycle_start_at.desc())
                    .first()
                )
                used = cycle.used_count if cycle else 0
                limit = sub.monthly_limit_snapshot or (plan.monthly_limit if plan else 0)
                remaining = max(0, int(limit or 0) - int(used or 0))
                status_msg += (
                    f"📦 Plan: *{plan.name if plan else 'Unknown'}*\n"
                    f"📅 Expires: {sub.end_at.strftime('%d %b %Y') if sub.end_at else 'N/A'}\n"
                    f"📊 Usage: {used}/{limit} solves\n"
                )
                if limit and remaining <= 0:
                    status_msg += (
                        "\n⚠️ Your solve quota is exhausted.\n"
                        "Use /renew to buy or renew a plan.\n"
                    )
            else:
                status_msg += (
                    f"📦 Plan: *N/A*\n"
                    f"📅 Expires: N/A\n"
                    f"📊 Usage: N/A\n"
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

    def _ocr_screenshot_full(self, filepath: Path) -> dict:
        """Try OCR on screenshot to extract UPI reference ID, amount, date, payer."""
        result = {"ref": None, "amount": None, "date": None, "payer": None}
        try:
            from PIL import Image
            img = Image.open(filepath)
            try:
                import pytesseract
                import re
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

    def run(self):
        """Start the bot using long-polling."""
        try:
            from telegram import Update, ReplyKeyboardMarkup, KeyboardButton
            from telegram.ext import Application, CommandHandler, MessageHandler, CallbackQueryHandler, filters, ContextTypes

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

            def _guest_keyboard():
                """Return a small onboarding keyboard for users not registered yet."""
                return ReplyKeyboardMarkup(
                    [
                        [KeyboardButton("📝 Register"), KeyboardButton("❓ Help")],
                    ],
                    resize_keyboard=True,
                )

            def _is_registered_user(telegram_user_id: str) -> bool:
                session = self._session()
                try:
                    return session.query(User).filter(
                        User.telegram_user_id == str(telegram_user_id)
                    ).first() is not None
                finally:
                    session.close()

            async def start_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
                uid = str(update.effective_user.id)
                chat_id = update.effective_chat.id
                was_registered = _is_registered_user(uid)
                msg = self.handle_start(chat_id, uid)
                state = self.get_state(chat_id)
                kwargs = {"parse_mode": "Markdown"}
                if was_registered or state["state"] != STATE_NAME:
                    kwargs["reply_markup"] = _main_keyboard()
                else:
                    kwargs["reply_markup"] = _guest_keyboard()
                try:
                    await update.message.reply_text(msg, **kwargs)
                except Exception:
                    # Some stored names/content can break Telegram Markdown parsing.
                    await update.message.reply_text(
                        msg.replace("*", "").replace("_", ""),
                        reply_markup=kwargs.get("reply_markup"),
                    )

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
                        await update.message.reply_text(
                            "✅ You are already registered.\n\n"
                            "Use /renew to buy/renew a plan, or /my_status to check your account.",
                            reply_markup=_main_keyboard(),
                        )
                        return
                finally:
                    session.close()

                # New user — start name collection (asked only once)
                self.set_state(chat_id, STATE_NAME)
                await update.message.reply_text(
                    "Let's register! What's your full name?\n\n"
                    "_Send your name as a message, or tap Help if you need guidance._",
                    parse_mode="Markdown",
                    reply_markup=_guest_keyboard())

            async def renew_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
                uid = str(update.effective_user.id)
                chat_id = update.effective_chat.id

                session = self._session()
                try:
                    user = session.query(User).filter(
                        User.telegram_user_id == uid
                    ).first()
                finally:
                    session.close()

                if not user:
                    await update.message.reply_text(
                        "❌ You're not registered yet.\nUse /register to create an account."
                    )
                    return

                self.set_state(chat_id, STATE_PLAN_SELECT, {
                    "full_name": user.full_name,
                    "mobile_number": user.mobile_number,
                    "is_renewal": True,
                })
                msg = (
                    f"🔄 *Renew Subscription*\n\n"
                    f"Welcome back, {user.full_name}. Select a plan to renew:\n\n"
                ) + self._get_plans_message()
                keyboard = self._build_plan_keyboard(chat_id)
                kwargs = {"parse_mode": "Markdown"}
                if keyboard:
                    kwargs["reply_markup"] = keyboard
                await update.message.reply_text(msg, **kwargs)

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
                    session = self._session()
                    try:
                        existing = session.query(User).filter(
                            User.telegram_user_id == uid
                        ).first()
                    finally:
                        session.close()
                    if existing:
                        await update.message.reply_text(
                            "✅ You are already registered.\n\n"
                            "Use /renew to buy/renew a plan, or /my_status to check your account.",
                            reply_markup=_main_keyboard(),
                        )
                        return
                    self.set_state(chat_id, STATE_NAME)
                    await update.message.reply_text(
                        "Let's register! What's your full name?\n\n"
                        "_Send your name as a message, or tap Help if you need guidance._",
                        parse_mode="Markdown",
                        reply_markup=_guest_keyboard())
                    return
                if text == "📊 My Status":
                    msg = self.handle_my_status(uid)
                    await update.message.reply_text(msg, parse_mode="Markdown")
                    return
                if text == "💳 Payments":
                    msg = self.handle_payment_status(uid)
                    await update.message.reply_text(msg, parse_mode="Markdown")
                    return
                if text == "🔑 My Key":
                    msg = self.handle_my_key(uid)
                    await update.message.reply_text(msg)
                    return
                if text == "🔄 New Key":
                    msg = self.handle_regenerate_key(uid)
                    await update.message.reply_text(msg, parse_mode="Markdown")
                    return
                if text == "❓ Help":
                    registered = _is_registered_user(uid)
                    await update.message.reply_text(
                        "🤖 *ta-ta Extension Bot*\n\n"
                        "New here? Tap *Register* and send your full name, mobile number, select a plan, then submit payment proof for admin approval.\n\n"
                        "📋 *Commands:*\n"
                        "/start — Welcome & info\n"
                        "/register — Start registration\n"
                        "/renew — Renew subscription\n"
                        "/payment_status — Payment history\n"
                        "/help — This help",
                        parse_mode="Markdown",
                        reply_markup=_main_keyboard() if registered else _guest_keyboard())
                    return

                # ── State machine ───────────────────────────────────────────
                qr_bytes = None
                qr_url = ""
                qr_path = None
                inline_keyboard = None
                in_registration = state["state"] in (STATE_NAME, STATE_MOBILE,
                    STATE_PLAN_SELECT, STATE_PAYMENT_INSTRUCTIONS)

                try:
                    if state["state"] == STATE_NAME:
                        reply = self.handle_name(chat_id, text)
                    elif state["state"] == STATE_MOBILE:
                        result = self.handle_mobile(chat_id, text, uid)
                        reply = result["text"]
                        inline_keyboard = result.get("inline_keyboard")
                    elif state["state"] == STATE_PLAN_SELECT:
                        result = self.handle_plan_select(chat_id, text)
                        reply = result["text"]
                        qr_bytes = result.get("qr_bytes")
                        qr_url = result.get("qr_url") or ""
                        qr_path = result.get("qr_path")
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
                if qr_path:
                    try:
                        with open(qr_path, "rb") as qr_file:
                            await update.message.reply_photo(
                                qr_file, caption="📱 Scan this QR to pay for the selected plan")
                    except Exception as e:
                        logger.error("qr_photo_file_failed", extra={"context": {"error": str(e), "path": str(qr_path)}})
                elif qr_url:
                    try:
                        await update.message.reply_photo(
                            qr_url, caption="📱 Scan this QR to pay for the selected plan")
                    except Exception as e:
                        logger.error("qr_photo_url_failed", extra={"context": {"error": str(e), "url": qr_url}})
                elif qr_bytes:
                    try:
                        await update.message.reply_photo(
                            qr_bytes, caption="📱 Scan this QR to pay via any UPI app")
                    except Exception as e:
                        logger.error("qr_photo_failed", extra={"context": {"error": str(e)}})

            async def help_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
                uid = str(update.effective_user.id)
                registered = _is_registered_user(uid)
                await update.message.reply_text(
                    "🤖 *ta-ta Extension Bot*\n\n"
                    "New here? Tap *Register* and send your full name, mobile number, select a plan, then submit payment proof for admin approval.\n\n"
                    "📋 *Commands:*\n"
                    "/start — Welcome & info\n"
                    "/register — Start registration\n"
                    "/renew — Renew subscription\n"
                    "/payment_status — Payment history\n"
                    "/help — This help",
                    parse_mode="Markdown",
                    reply_markup=_main_keyboard() if registered else _guest_keyboard()
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
                        f"Your payment is already being processed. Use /payment_status to check.",
                        parse_mode="Markdown")
                    return

                result = self.handle_plan_select_by_id(chat_id, plan_id)
                if not result.get("qr_bytes") and not result.get("qr_url") and not result.get("qr_path") and not result.get("inline_keyboard"):
                    await query.edit_message_text(result["text"], parse_mode="Markdown")
                    return

                try:
                    await query.edit_message_text(
                        result["text"],
                        parse_mode="Markdown",
                        reply_markup=result.get("inline_keyboard"),
                    )
                except Exception:
                    await query.edit_message_text(result["text"], parse_mode="Markdown")

                try:
                    if result.get("qr_path"):
                        with open(result["qr_path"], "rb") as qr_file:
                            await context.bot.send_photo(
                                chat_id=chat_id,
                                photo=qr_file,
                                caption="📱 Scan this QR to pay for the selected plan",
                            )
                    elif result.get("qr_url"):
                        await context.bot.send_photo(
                            chat_id=chat_id,
                            photo=result["qr_url"],
                            caption="📱 Scan this QR to pay for the selected plan",
                        )
                    elif result.get("qr_bytes"):
                        await context.bot.send_photo(
                            chat_id=chat_id,
                            photo=result["qr_bytes"],
                            caption="📱 Scan this QR to pay via any UPI app",
                        )
                except Exception as e:
                    logger.error("qr_photo_failed", extra={"context": {"error": str(e)}})

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
                import os as _os
                upload_dir = Path(__file__).resolve().parents[3] / "data" / "payment_screenshots"
                upload_dir.mkdir(parents=True, exist_ok=True)
                filename = f"pay_{uid}_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}.jpg"
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
                    created_user = False
                    user = session.query(User).filter(
                        User.telegram_user_id == uid
                    ).first()
                    if user:
                        user.full_name = state["data"].get("full_name", user.full_name)
                        user.mobile_number = state["data"].get("mobile_number", user.mobile_number)
                        user.telegram_chat_id = str(chat_id)
                        user.status = "pending_payment"
                    else:
                        user = User(
                            full_name=state["data"].get("full_name", ""),
                            mobile_number=state["data"].get("mobile_number"),
                            telegram_user_id=uid,
                            telegram_chat_id=str(chat_id),
                            status="pending_payment",
                        )
                        session.add(user)
                        session.flush()
                        created_user = True

                    # Try to find existing payment record by payment_ref
                    existing_payment = None
                    if expected_ref:
                        existing_payment = session.query(PaymentRecord).filter(
                            PaymentRecord.payment_ref == expected_ref,
                            PaymentRecord.user_id == user.id,
                        ).first()

                    if existing_payment:
                        # Update existing payment with screenshot + OCR data
                        payment = existing_payment
                        existing_payment.payment_screenshot_path = str(filepath)
                        existing_payment.ocr_matched = ocr_matched
                        existing_payment.ocr_extracted_ref = extracted_ref
                        existing_payment.ocr_extracted_amount = ocr_data.get("amount")
                        existing_payment.ocr_extracted_date = ocr_data.get("date")
                        existing_payment.ocr_extracted_payer = ocr_data.get("payer")
                        existing_payment.upi_reference = extracted_ref or existing_payment.upi_reference
                        existing_payment.status = new_status
                        existing_payment.updated_at = datetime.now(timezone.utc)
                        session.commit()
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
                            submitted_at=datetime.now(timezone.utc),
                        )
                        session.add(payment)
                        session.commit()

                    payment_id = payment.id
                    user_id = user.id
                    if created_user:
                        self._safe_audit_log(
                            actor_type="bot",
                            action="telegram_user_created",
                            actor_id=user_id,
                            target_type="user",
                            target_id=user_id,
                            after_json=json.dumps({
                                "telegram_user_id": uid,
                                "telegram_chat_id": str(chat_id),
                                "mobile_number": state["data"].get("mobile_number"),
                            }),
                        )
                    self._safe_audit_log(
                        actor_type="bot",
                        action="telegram_payment_screenshot_uploaded",
                        actor_id=user_id,
                        target_type="payment",
                        target_id=payment_id,
                        after_json=json.dumps({
                            "payment_ref": expected_ref,
                            "detected_ref": extracted_ref,
                            "ocr_matched": ocr_matched,
                            "status": new_status,
                        }),
                    )
                    self._notify_payment_in_background(payment_id, "payment_screenshot_submitted")

                    ref = expected_ref or "N/A"
                    reply = (
                        f"📸 *Screenshot received!*\n\n"
                        f"• Ref: `{ref}`\n"
                        f"• Detected UPI Ref: `{extracted_ref or 'not detected'}`\n\n"
                        f"Payment submitted for approval. Please wait 1-2 hours."
                    )
                except Exception as e:
                    session.rollback()
                    logger.error("screenshot_submit_failed", extra={"context": {"error": str(e)}})
                    reply = "Failed to process screenshot. Please try again."
                finally:
                    session.close()

                self.set_state(chat_id, STATE_COMPLETE)
                await update.message.reply_text(reply, parse_mode="Markdown",
                    reply_markup=_main_keyboard())

            app.add_handler(CommandHandler("start", start_cmd))
            app.add_handler(CommandHandler("register", register_cmd))
            app.add_handler(CommandHandler("renew", renew_cmd))
            app.add_handler(CommandHandler("my_status", status_cmd))
            app.add_handler(CommandHandler("mystatus", status_cmd))
            app.add_handler(CommandHandler("my_key", key_cmd))
            app.add_handler(CommandHandler("mykey", key_cmd))
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

    from app.core.db import init_db, get_session

    settings = get_settings()
    require_runtime_auth(settings, require_admin_token=False)
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
    import os, sys
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../.."))

    from app.core.db import init_db, get_session

    settings = get_settings()
    require_runtime_auth(settings, require_admin_token=False)
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
    import os, threading
    from sqlalchemy import text
    settings = settings or get_settings()
    require_runtime_auth(settings, require_admin_token=False)
    token = os.getenv("TELEGRAM_BOT_TOKEN", "")
    if not token:
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
