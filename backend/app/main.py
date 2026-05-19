"""FastAPI entrypoint — Unified Platform."""

from __future__ import annotations

import asyncio
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path as _Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.admin import router as admin_router
from app.api.routes import router as v1_router
from app.core.config import get_settings
from app.core.container import build_container
from app.core.db import get_session
from app.core.logging import configure_logging
from app.middleware.auth_middleware import AuthMiddleware
from app.middleware.logging_middleware import LoggingMiddleware
from app.middleware.rate_limit_middleware import RateLimitMiddleware

settings = get_settings()
configure_logging(settings=settings)
container = build_container(settings=settings)
logger = logging.getLogger(__name__)

_API_VERSION = "2.0.0"


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


@asynccontextmanager
async def lifespan(application: FastAPI):
    """Manage startup and shutdown lifecycle."""
    # ── Startup ───────────────────────────────────────────────────────────────
    await container.solver_service.start()
    # Send WhatsApp notification that server is online (non-blocking)
    container.alert_service.notify_server_start()
    
    # Auto-package extension on start
    container.extension_service.package_extension()

    # Wire user key service for auth middleware (from container)
    application.state.user_key_service = container.user_key_service

    # Telegram polling must be a single process. Run it separately when using
    # multiple uvicorn workers, or opt in for single-worker development.
    if os.getenv("START_TELEGRAM_BOT_IN_API", "").lower() in {"1", "true", "yes", "on"}:
        from app.services.telegram_bot import start_bot
        bot = start_bot(settings=settings, session_factory=get_session)
        if bot:
            application.state.telegram_bot = bot

    merge_task = asyncio.create_task(_exam_merge_loop(container))
    backup_task = asyncio.create_task(_backup_scheduler(container))

    yield

    # ── Shutdown ──────────────────────────────────────────────────────────────
    merge_task.cancel()
    backup_task.cancel()
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
