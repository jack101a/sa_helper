"""FastAPI entrypoint — Unified Platform."""

from __future__ import annotations

import asyncio
import html
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path as _Path

from fastapi import FastAPI
from fastapi.responses import HTMLResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.admin import router as admin_router
from app.api.routes import router as v1_router
from app.background_tasks import backup_scheduler, exam_merge_loop, subscription_expiry_loop
from app.core.config import get_settings, require_runtime_auth
from app.core.container import build_container
from app.core.db import get_session
from app.core.logging import configure_logging
from app.core.payment_links import build_upi_link, decode_upi_payload
from app.middleware.auth_middleware import AuthMiddleware
from app.middleware.logging_middleware import LoggingMiddleware
from app.middleware.rate_limit_middleware import RateLimitMiddleware
from app.middleware.security_headers_middleware import SecurityHeadersMiddleware

settings = get_settings()
require_runtime_auth(settings)
configure_logging(settings=settings)
container = build_container(settings=settings)
logger = logging.getLogger(__name__)

_API_VERSION = "2.0.0"


def _env_enabled(name: str, default: str = "false") -> bool:
    return os.getenv(name, default).lower() in {"1", "true", "yes", "on"}


@asynccontextmanager
async def lifespan(application: FastAPI):
    """Manage startup and shutdown lifecycle."""
    # ── Startup ───────────────────────────────────────────────────────────────
    await container.solver_service.start()
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
            asyncio.create_task(exam_merge_loop(container)),
            asyncio.create_task(backup_scheduler(container)),
            asyncio.create_task(subscription_expiry_loop(container)),
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
