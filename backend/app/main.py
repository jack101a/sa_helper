"""FastAPI entrypoint — Unified Platform."""

from __future__ import annotations

import asyncio
import html
import logging
import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone, timedelta
from pathlib import Path as _Path

from fastapi import FastAPI
from fastapi.responses import HTMLResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.admin import router as admin_router
from app.api.routes import router as v1_router
from app.core.config import get_settings
from app.core.container import build_container
from app.core.db import get_session
from app.core.logging import configure_logging
from app.core.payment_links import build_upi_link, decode_upi_payload
from app.middleware.auth_middleware import AuthMiddleware
from app.middleware.logging_middleware import LoggingMiddleware
from app.middleware.rate_limit_middleware import RateLimitMiddleware
from app.middleware.security_headers_middleware import SecurityHeadersMiddleware

settings = get_settings()
configure_logging(settings=settings)
container = build_container(settings=settings)
logger = logging.getLogger(__name__)

_API_VERSION = "2.0.0"


def _env_enabled(name: str, default: str = "false") -> bool:
    return os.getenv(name, default).lower() in {"1", "true", "yes", "on"}


async def _exam_merge_loop(container) -> None:
    """Auto-merge verified learned questions into main bank on schedule."""
    while True:
        try:
            interval_hours = 6
            try:
                interval_hours = max(1, int(container.db.get_setting("exam.merge_interval_hours", "6")))
            except (ValueError, TypeError):
                pass

            merge_enabled = container.db.get_setting(
                "exam.auto_merge_enabled", "true"
            ).lower() in ("true", "1", "yes", "on")

            if not merge_enabled:
                await asyncio.sleep(3600)  # check again in 1 hour
                continue

            await asyncio.sleep(interval_hours * 3600)

            result = container.exam_merge_service.merge_verified_to_main()
            if result["merged"] > 0:
                logger.info("exam_auto_merge", extra={"context": result})
                # Send alert if alert_service exists
                try:
                    container.alert_service.send(
                        f"📚 MCQ Bank Merge: {result['merged']} new questions merged "
                        f"(total: {result['total_bank']})"
                    )
                except Exception:
                    pass
        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.error("exam_auto_merge_failed", extra={"context": {"error": str(e)}})
            await asyncio.sleep(3600)  # retry in 1 hour on failure


async def _backup_scheduler(container) -> None:
    """Run automated system + user backups on schedule."""
    # Wait 60 seconds after startup before first check
    await asyncio.sleep(60)
    while True:
        try:
            enabled = container.db.get_setting(
                "backup.enabled", "true"
            ).lower() in ("true", "1", "yes", "on")

            if not enabled:
                await asyncio.sleep(3600)
                continue

            interval_hours = 6
            try:
                interval_hours = max(1, int(container.db.get_setting("backup.interval_hours", "6")))
            except (ValueError, TypeError):
                pass

            await asyncio.sleep(interval_hours * 3600)

            # Create backups
            sys_result = container.backup_service.create_system_backup()
            user_result = container.backup_service.create_user_backup()

            # rclone sync (non-critical)
            for path in [sys_result["path"], user_result["path"]]:
                try:
                    container.backup_service.rclone_sync(path)
                except Exception as e:
                    logger.warning(f"backup_rclone_skip: {e}")

            # Telegram backup (non-critical)
            for path in [sys_result["path"], user_result["path"]]:
                try:
                    await container.backup_service.telegram_backup(path)
                except Exception as e:
                    logger.warning(f"backup_telegram_skip: {e}")

            # Alert admin
            try:
                container.alert_service.send(
                    f"✅ Backup: system ({sys_result['size']//1024}KB), "
                    f"users ({user_result['size']//1024}KB)"
                )
            except Exception:
                pass

        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.error("backup_scheduler_failed", extra={"context": {"error": str(e)}})
            await asyncio.sleep(3600)


async def _subscription_expiry_loop(container) -> None:
    """Check for expired subscriptions every hour."""
    await asyncio.sleep(120)  # wait 2 min after startup
    while True:
        try:
            token = os.getenv("TELEGRAM_BOT_TOKEN", "")

            # Check for subscriptions expiring in 3 days — send warning
            try:
                from app.core.models import UserSubscription, User
                session = get_session()
                now_dt = datetime.now(timezone.utc)
                three_days = now_dt + timedelta(days=3)
                soon = (
                    session.query(UserSubscription)
                    .filter(
                        UserSubscription.status == "active",
                        UserSubscription.end_at.between(now_dt, three_days),
                    )
                    .all()
                )
                if soon and token:
                    from telegram import Bot
                    bot = Bot(token=token)
                    for sub in soon:
                        user = session.query(User).filter(User.id == sub.user_id).first()
                        if user and user.telegram_chat_id:
                            days_left = (sub.end_at - now_dt).days
                            try:
                                await bot.send_message(
                                    chat_id=int(user.telegram_chat_id),
                                    text=(
                                        "⏰ *Subscription Expiring Soon*\n\n"
                                        f"Your plan expires in *{days_left} days*.\n"
                                        "Use /renew to continue your service."
                                    ),
                                    parse_mode="Markdown",
                                )
                            except Exception:
                                pass
                session.close()
            except Exception as e:
                logger.warning(f"expiry_warning_failed: {e}")

            expired_users = container.subscription_service.expire_overdue()
            if expired_users:
                logger.info(f"auto_expired: {len(expired_users)} subscriptions")
                if token:
                    try:
                        from telegram import Bot
                        bot = Bot(token=token)
                        for user_info in expired_users:
                            chat_id = user_info.get("telegram_chat_id")
                            if chat_id:
                                await bot.send_message(
                                    chat_id=int(chat_id),
                                    text=(
                                        "⚠️ *Subscription Expired*\n\n"
                                        "Your subscription has expired.\n"
                                        "Use /renew to purchase a new plan."
                                    ),
                                    parse_mode="Markdown",
                                )
                    except Exception as e:
                        logger.warning(f"expiry_notify_failed: {e}")
        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.error(f"expiry_check_failed: {e}")
        await asyncio.sleep(3600)  # check every hour


@asynccontextmanager
async def lifespan(application: FastAPI):
    """Manage startup and shutdown lifecycle."""
    # ── Startup ───────────────────────────────────────────────────────────────
    await container.solver_service.start()
    # Send WhatsApp notification that server is online (non-blocking)
    container.alert_service.notify_server_start()
    
    # Auto-package extension on start
    container.extension_service.package_extension()

    try:
        result = container.exam_offline_import_service.import_available()
        if result.get("inserted") or result.get("updated") or result.get("errors"):
            logger.info("exam_offline_import_startup", extra={"context": result})
    except Exception as e:
        logger.warning("exam_offline_import_startup_failed", extra={"context": {"error": str(e)}})

    # Wire user key service for auth middleware (from container)
    application.state.user_key_service = container.user_key_service

    # Telegram polling must be a single process. Run it separately when using
    # multiple uvicorn workers, or opt in for single-worker development.
    if os.getenv("START_TELEGRAM_BOT_IN_API", "").lower() in {"1", "true", "yes", "on"}:
        from app.services.telegram_bot import start_bot
        bot = start_bot(settings=settings, session_factory=get_session)
        if bot:
            application.state.telegram_bot = bot

    background_tasks: list[asyncio.Task] = []
    if _env_enabled("RUN_BACKGROUND_TASKS"):
        background_tasks = [
            asyncio.create_task(_exam_merge_loop(container)),
            asyncio.create_task(_backup_scheduler(container)),
            asyncio.create_task(_subscription_expiry_loop(container)),
        ]

    yield

    # ── Shutdown ──────────────────────────────────────────────────────────────
    for task in background_tasks:
        task.cancel()
    await container.solver_service.stop()

    # Guard: retrain_service is optional — only wired when the feature is on
    retrain = getattr(container, "retrain_service", None)
    if retrain is not None:
        await retrain.stop()

    # Close the exam service HTTP client via the public helper so we never
    # depend on private attribute names.
    await container.exam_service.close()


app = FastAPI(
    title="Unified Platform API",
    description="Text Captcha · MCQ Exam Solver · Autofill — Multi-user SaaS",
    version=_API_VERSION,
    debug=settings.server.debug,
    lifespan=lifespan,
)
app.state.container = container

# Middleware (order: outermost added last executes first)
app.add_middleware(LoggingMiddleware)
app.add_middleware(AuthMiddleware, settings=settings, key_service=container.key_service)
app.add_middleware(RateLimitMiddleware, settings=settings)
app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.server.cors_origins,
    allow_origin_regex=settings.server.cors_origin_regex,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(v1_router)
app.include_router(admin_router)

# Static assets
_static_dir = _Path(__file__).resolve().parent / "static"
_static_dir.mkdir(parents=True, exist_ok=True)
app.mount("/static", StaticFiles(directory=str(_static_dir)), name="static")

_admin_assets = _Path(__file__).resolve().parents[2] / "frontend" / "dist" / "assets"
if _admin_assets.exists():
    app.mount("/assets", StaticFiles(directory=str(_admin_assets)), name="admin_assets")


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "unified-platform", "version": _API_VERSION}


@app.get("/pay/upi", response_class=HTMLResponse)
async def pay_upi(t: str = "") -> HTMLResponse:
    payload = decode_upi_payload(t)
    if not payload:
        return HTMLResponse("Invalid or expired payment link.", status_code=400)

    upi_link = build_upi_link(
        upi_id=str(payload.get("pa", "")),
        name=str(payload.get("pn", "")),
        amount=float(payload.get("am", "0") or "0"),
        note=str(payload.get("tn", "")),
        currency=str(payload.get("cu", "INR") or "INR"),
    )
    safe_upi = html.escape(upi_link, quote=True)
    safe_upi_id = html.escape(str(payload.get("pa", "")))
    safe_amount = html.escape(str(payload.get("am", "")))
    safe_note = html.escape(str(payload.get("tn", "")))

    page = f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>UPI Payment</title>
  <meta http-equiv="refresh" content="0; url={safe_upi}">
  <style>
    body {{ font-family: Arial, sans-serif; margin: 0; padding: 24px; line-height: 1.45; }}
    .card {{ max-width: 560px; margin: 0 auto; border: 1px solid #ddd; border-radius: 10px; padding: 16px; }}
    .btn {{ display: inline-block; padding: 10px 14px; border-radius: 8px; border: 1px solid #222; text-decoration: none; color: #111; }}
    .muted {{ color: #555; font-size: 14px; }}
  </style>
</head>
<body>
  <div class="card">
    <h2>Continue to UPI App</h2>
    <p class="muted">If your app does not open automatically, tap the button below.</p>
    <p><a class="btn" href="{safe_upi}">Open UPI App</a></p>
    <hr>
    <p><strong>UPI ID:</strong> {safe_upi_id}</p>
    <p><strong>Amount:</strong> {safe_amount}</p>
    <p><strong>Note:</strong> {safe_note}</p>
  </div>
  <script>
    try {{ window.location.href = "{safe_upi}"; }} catch (_) {{}}
  </script>
</body>
</html>"""
    return HTMLResponse(page, status_code=200)
