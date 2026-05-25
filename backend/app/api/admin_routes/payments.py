"""Admin API — Payment approval workflow."""

from __future__ import annotations

import json
import logging
from typing import Any

from fastapi import APIRouter, Request, Query
from fastapi.responses import JSONResponse, FileResponse

from .utils import _admin_guard

logger = logging.getLogger(__name__)

router = APIRouter(tags=["admin-payments"])


@router.get("/api/payments")
async def list_payments(
    request: Request,
    status: str | None = Query(None),
    user_id: int | None = Query(None),
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
) -> Any:
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    payments, total = container.payment_service.list_payments(
        status=status, user_id=user_id, offset=offset, limit=limit
    )
    return JSONResponse({
        "payments": [p.to_dict() for p in payments],
        "total": total,
        "offset": offset,
        "limit": limit,
    })


@router.get("/api/payments/pending-count")
async def pending_payment_count(request: Request) -> Any:
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    count = container.payment_service.get_pending_count()
    return JSONResponse({"pending_count": count})


@router.post("/api/payments/{payment_id}/approve")
async def approve_payment(request: Request, payment_id: int) -> Any:
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container

    # Use a single session for the entire approve+activate flow (atomic)
    from app.core.models import User, UserSubscription, UserApiKey, SubscriptionPlan, PaymentRecord
    from app.core.db import get_session
    from app.core.config import get_settings
    from app.core.security import generate_plain_api_key, hash_api_key
    from datetime import datetime, timezone, timedelta

    session = get_session()
    try:
        payment = session.query(PaymentRecord).filter(PaymentRecord.id == payment_id).first()
        if not payment:
            return JSONResponse({"error": "Payment not found"}, status_code=404)

        # Mark payment approved
        now = datetime.now(timezone.utc)
        payment.status = "approved"
        payment.verified_at = now
        payment.updated_at = now

        # Auto-activate: create subscription + activate user + create key
        user = session.query(User).filter(User.id == payment.user_id).first()
        plan = None
        plain_key_for_user = None
        if user:
            if payment.plan_id:
                plan = session.query(SubscriptionPlan).filter(
                    SubscriptionPlan.id == payment.plan_id
                ).first()
            if not plan:
                plan = session.query(SubscriptionPlan).filter(
                    SubscriptionPlan.price_amount == payment.amount,
                    SubscriptionPlan.is_active == True,
                ).first()

            if plan:
                # Deactivate existing active subscriptions
                session.query(UserSubscription).filter(
                    UserSubscription.user_id == user.id,
                    UserSubscription.status == "active",
                ).update({"status": "expired", "updated_at": now})

                # Create new subscription with correct plan duration
                sub = UserSubscription(
                    user_id=user.id,
                    plan_id=plan.id,
                    status="active",
                    monthly_limit_snapshot=plan.monthly_limit,
                    start_at=now,
                    end_at=now + timedelta(days=plan.duration_days),
                    billing_anchor_day=now.day,
                    current_cycle_start_at=now,
                    current_cycle_end_at=now + timedelta(days=30),
                    approved_by_admin_id=None,
                    approved_at=now,
                )
                session.add(sub)
                session.flush()
                payment.subscription_id = sub.id

                # Create initial UsageCycle
                from app.core.models import UsageCycle
                cycle = UsageCycle(
                    user_id=user.id,
                    subscription_id=sub.id,
                    cycle_start_at=now,
                    cycle_end_at=now + timedelta(days=30),
                    monthly_limit=plan.monthly_limit,
                    used_count=0,
                )
                session.add(cycle)

            # Activate user
            user.status = "active"
            user.updated_at = now

            # Create API key if none active
            existing_key = session.query(UserApiKey).filter(
                UserApiKey.user_id == user.id,
                UserApiKey.status == "active",
            ).first()
            if not existing_key:
                settings = get_settings()
                created_plain = generate_plain_api_key(settings)
                created_key = UserApiKey(
                    user_id=user.id,
                    key_hash=hash_api_key(created_plain, settings.auth.hash_salt),
                    key_prefix_display=created_plain[:10] + "...",
                    status="active",
                    key_version=1,
                    issued_at=now,
                    expires_at=None,
                )
                session.add(created_key)
                session.flush()
                plain_key_for_user = created_plain
                existing_key = created_key
            else:
                existing_key.expires_at = None
                existing_key.revoked_at = None
                existing_key.revoked_reason = ""

            # Copy plan entitlements to API key
            if plan:
                try:
                    active_key = existing_key or session.query(UserApiKey).filter(
                        UserApiKey.user_id == user.id,
                        UserApiKey.status == "active",
                    ).first()
                    if active_key:
                        if plan.allowed_services:
                            container.db.set_api_key_entitlements(
                                int(active_key.id),
                                services=plan.allowed_services,
                            )
                        container.db.set_api_key_rate_limit(
                            int(active_key.id),
                            requests_per_minute=int(plan.rate_limit_rpm or 60),
                            burst=int(getattr(plan, "rate_limit_burst", 10) or 10),
                        )
                except Exception as e:
                    logger.warning(f"entitlement_copy_failed: {e}")

        # Commit everything atomically
        session.commit()
        session.refresh(payment)

        # Notify user via Telegram (after commit, non-critical)
        if user and user.telegram_chat_id and plan:
            try:
                plan_name = plan.name
                expiry_date = (now + timedelta(days=plan.duration_days)).strftime('%d %b %Y')
                notify_msg = (
                    f"✅ *Payment Approved!*\n\n"
                    f"🎉 Your payment of ₹{payment.amount/100:.2f} has been approved.\n"
                    f"📦 Plan: *{plan_name}*\n"
                    f"📅 Expires: {expiry_date}\n"
                    f"📊 Limit: {plan.monthly_limit} solves/month\n\n"
                )
                if plain_key_for_user:
                    notify_msg += (
                        f"🔑 *Your API key (save now):*\n"
                        f"`{plain_key_for_user}`\n\n"
                    )
                else:
                    notify_msg += (
                        f"🔑 Your API key is active. Open the bot keyboard and tap *My Key*.\n\n"
                    )
                notify_msg += (
                    f"Use the bot keyboard buttons for account status and key info."
                )
                await _try_notify_user(user.telegram_user_id, notify_msg, container)
            except Exception as e:
                logger.error("notify_approval_failed", extra={"context": {"error": str(e)}})

    except Exception as e:
        session.rollback()
        logger.error("payment_approve_auto_activate_failed", extra={"context": {"error": str(e)}})
        return JSONResponse({"error": "Failed to process approval"}, status_code=500)
    finally:
        session.close()

    container.audit_service.log(
        actor_type="admin", action="payment_approved",
        target_type="payment", target_id=payment_id,
    )
    return JSONResponse(payment.to_dict())


@router.post("/api/payments/{payment_id}/reject")
async def reject_payment(request: Request, payment_id: int) -> Any:
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    body = await request.json()
    reason = body.get("rejection_reason", "")

    payment = container.payment_service.reject_payment(payment_id, rejection_reason=reason)
    if not payment:
        return JSONResponse({"error": "Payment not found"}, status_code=404)

    container.audit_service.log(
        actor_type="admin", action="payment_rejected",
        target_type="payment", target_id=payment_id,
        after_json=json.dumps({"reason": reason}),
    )

    # Notify user
    from app.core.models import User
    from app.core.db import get_session
    session = get_session()
    try:
        user = session.query(User).filter(User.id == payment.user_id).first()
        if user:
            notify_msg = (
                f"❌ *Payment Rejected*\n\n"
                f"Your payment of ₹{payment.amount/100:.2f} was rejected.\n"
            )
            if reason:
                notify_msg += f"Reason: _{reason}_\n\n"
            notify_msg += "Please contact support or try again with /register"
            await _try_notify_user(user.telegram_user_id, notify_msg, container)
    except Exception:
        pass
    finally:
        session.close()

    return JSONResponse(payment.to_dict())


# ── Screenshot Serving ─────────────────────────────────────────────────────

from pathlib import Path

# Configured base directory for payment screenshots
# Keep this aligned with telegram_bot.py upload path (project_root/data/payment_screenshots).
_SCREENSHOTS_DIR = Path(__file__).resolve().parents[4] / "data" / "payment_screenshots"


async def _try_notify_user(telegram_user_id: str, message: str, container) -> bool:
    """Try to send a Telegram notification to a user. Falls back gracefully."""
    try:
        import os
        token = os.getenv("TELEGRAM_BOT_TOKEN", "")
        if not token and container.settings:
            token = container.settings.telegram.bot_token
        if not token:
            from app.core.db import get_session
            from sqlalchemy import text
            session = get_session()
            row = session.execute(
                text("SELECT value FROM platform_settings WHERE key = :key"),
                {"key": "telegram.bot_token"},
            ).fetchone()
            session.close()
            if row and row[0]:
                token = row[0]
        if not token:
            return False

        from app.core.models import User
        from app.core.db import get_session
        session = get_session()
        user = session.query(User).filter(
            User.telegram_user_id == str(telegram_user_id)
        ).first()
        session.close()
        if not user or not user.telegram_chat_id:
            return False

        from telegram import Bot
        bot = Bot(token=token)
        await bot.send_message(
            chat_id=int(user.telegram_chat_id),
            text=message,
            parse_mode="Markdown",
        )
        return True
    except Exception:
        return False


@router.get("/api/payments/{payment_id}/screenshot")
async def get_payment_screenshot(request: Request, payment_id: int) -> Any:
    """Serve the payment screenshot image."""
    denied = _admin_guard(request)
    if denied:
        return denied
    from app.core.models import PaymentRecord
    from app.core.db import get_session
    session = get_session()
    try:
        payment = session.query(PaymentRecord).filter(PaymentRecord.id == payment_id).first()
        if not payment or not payment.payment_screenshot_path:
            return JSONResponse({"error": "No screenshot"}, status_code=404)
        path = Path(payment.payment_screenshot_path).resolve()
        # Prevent path traversal: ensure the resolved path is within the screenshots directory
        if _SCREENSHOTS_DIR.resolve() not in path.parents and path != _SCREENSHOTS_DIR.resolve():
            return JSONResponse({"error": "Invalid screenshot path"}, status_code=403)
        if not path.exists():
            return JSONResponse({"error": "Screenshot file not found"}, status_code=404)
        return FileResponse(str(path), media_type="image/jpeg")
    finally:
        session.close()
