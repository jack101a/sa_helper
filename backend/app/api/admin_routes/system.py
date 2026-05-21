"""Admin API — System operations (backup, restore, usage, health)."""

from __future__ import annotations

from typing import Any

import os, signal, subprocess, sys, shlex
from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from .utils import _admin_guard

router = APIRouter(tags=["admin-system"])


# ── Backup ─────────────────────────────────────────────────────────────────

@router.get("/api/system/backups")
async def list_backups(request: Request) -> Any:
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    svc = container.backup_service
    return JSONResponse({"backups": svc.list_backups()})


@router.post("/api/system/backup")
async def create_backup(request: Request) -> Any:
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    svc = container.backup_service
    result = svc.full_backup()
    return JSONResponse(result)


@router.post("/api/system/restore/{backup_id}")
async def restore_backup(request: Request, backup_id: str) -> Any:
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    svc = container.backup_service
    result = svc.restore_from_backup(backup_id)
    return JSONResponse(result)


@router.get("/api/system/backup-health")
async def backup_health(request: Request) -> Any:
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    svc = container.backup_service
    return JSONResponse(svc.get_backup_health())


# ── Usage / Quota ──────────────────────────────────────────────────────────

@router.get("/api/users/{user_id}/usage")
async def get_user_usage(request: Request, user_id: int) -> Any:
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    usage = container.usage_cycle_service.get_user_usage(user_id)
    return JSONResponse(usage)


@router.post("/api/users/{user_id}/usage/reset")
async def reset_user_cycle(request: Request, user_id: int) -> Any:
    """Admin override: reset the current usage cycle (grant bonus quota)."""
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    cycle = container.usage_cycle_service.reset_cycle(user_id)
    if not cycle:
        return JSONResponse({"error": "Failed to reset cycle"}, status_code=400)
    container.audit_service.log(
        actor_type="admin", action="usage_cycle_reset",
        target_type="user", target_id=user_id,
    )
    return JSONResponse({"ok": True, "new_cycle_id": cycle.id})


# ── System Health ──────────────────────────────────────────────────────────

@router.get("/api/system/health")
async def system_health(request: Request) -> Any:
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container

    # Count totals
    from app.core.db import get_session
    from app.core.models import User, PaymentRecord, UserSubscription

    session = get_session()
    try:
        total_users = session.query(User).count()
        active_users = session.query(User).filter(User.status == "active").count()
        pending_payments = session.query(PaymentRecord).filter(PaymentRecord.status == "pending").count()
        active_subs = session.query(UserSubscription).filter(UserSubscription.status == "active").count()
    finally:
        session.close()

    return JSONResponse({
        "service": "unified-platform",
        "version": "2.0.0",
        "db_type": container.settings.storage.db_type,
        "redis_enabled": container.settings.redis.enabled,
        "users": {"total": total_users, "active": active_users},
        "payments_pending": pending_payments,
        "active_subscriptions": active_subs,
    })


@router.post("/api/exam/merge")
async def force_exam_merge(request: Request) -> Any:
    """Manually trigger merge of verified learned questions into main bank."""
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    try:
        result = container.exam_merge_service.merge_verified_to_main()
        return JSONResponse(result)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@router.get("/api/exam/training-stats")
async def exam_training_stats(request: Request) -> Any:
    """Return training pipeline statistics for admin dashboard."""
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    try:
        stats = container.exam_merge_service.get_merge_stats()
        return JSONResponse(stats)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


# ── Server Restart ───────────────────────────────────────────────────────────

@router.post("/api/system/restart")
async def restart_server(request: Request) -> Any:
    """Restart the backend server and Telegram bot."""
    denied = _admin_guard(request)
    if denied:
        return denied

    script = Path(__file__).resolve().parents[4] / "scripts" / "start_backend.sh"
    if not script.exists():
        return JSONResponse({"ok": False, "error": "start script not found"}, status_code=500)

    # Spawn restart in a detached subprocess.
    # Use a shell command that waits 2s (to let the HTTP response be sent),
    # then kills old processes, then starts fresh ones.
    # start_new_session=True ensures the child survives even if parent is killed.
    cmd = (
        f"sleep 2; "
        f"pkill -9 -f 'uvicorn app.main' 2>/dev/null; "
        f"pkill -9 -f 'telegram_bot' 2>/dev/null; "
        f"exec bash {shlex.quote(str(script))}"
    )
    subprocess.Popen(
        ["bash", "-c", cmd],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        start_new_session=True,
    )
    return {"ok": True, "message": "Server restarting..."}
