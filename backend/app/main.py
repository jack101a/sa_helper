"""FastAPI entrypoint — Unified Platform."""

from __future__ import annotations

import os
from pathlib import Path as _Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.admin import router as admin_router
from app.api.routes import router as v1_router
from app.core.config import get_settings
from app.core.container import build_container
from app.core.logging import configure_logging
from app.middleware.auth_middleware import AuthMiddleware
from app.middleware.logging_middleware import LoggingMiddleware
from app.middleware.rate_limit_middleware import RateLimitMiddleware

settings  = get_settings()
configure_logging(settings=settings)
container = build_container(settings=settings)

app = FastAPI(
    title="Unified Platform API",
    description="Text Captcha · MCQ Exam Solver · Autofill — Multi-user SaaS",
    version="2.0.0",
    debug=settings.server.debug,
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

_admin_assets = _Path(__file__).resolve().parents[1] / "admin-ui" / "dist" / "assets"
if _admin_assets.exists():
    app.mount("/assets", StaticFiles(directory=str(_admin_assets)), name="admin_assets")


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "unified-platform", "version": "2.0.0"}


@app.on_event("startup")
async def startup() -> None:
    await container.solver_service.start()
    if container.settings.retrain.worker_enabled:
        await container.retrain_service.start()
    # WhatsApp: notify admin server is online
    container.alert_service.notify_server_start()


@app.on_event("shutdown")
async def shutdown() -> None:
    await container.solver_service.stop()
    if container.settings.retrain.worker_enabled:
        await container.retrain_service.stop()
    # Close exam service HTTP client
    await container.exam_service._http.aclose()
