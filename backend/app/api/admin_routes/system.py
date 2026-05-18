"""Admin API - System operations (backup, restore, usage, health)."""

from __future__ import annotations

import shlex
import subprocess
from pathlib import Path
from typing import Any

from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse

from app.workers.dispatch import run_task_with_timeout

from .utils import _admin_guard

router = APIRouter(tags=["admin-system"])


async def _optional_json(request: Request) -> dict[str, Any]:
    try:
        body = await request.json()
        return body if isinstance(body, dict) else {}
    except Exception:
        return {}


# ----- Backup APIs -----

@router.get("/api/system/backup/config")
async def backup_config(request: Request) -> Any:
    denied = _admin_guard(request)
    if denied:
        return denied
    return JSONResponse(request.app.state.container.backup_service.get_backup_config_status())


@router.post("/api/system/backup/config")
async def set_backup_config(request: Request) -> Any:
    denied = _admin_guard(request)
    if denied:
        return denied
    body = await _optional_json(request)
    updates = body.get("settings") if isinstance(body.get("settings"), dict) else body
    try:
        return JSONResponse(request.app.state.container.backup_service.set_backup_settings(updates))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/api/system/backup/run")
async def run_backup_now(request: Request) -> Any:
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    body = await _optional_json(request)

    use_worker = bool(body.get("use_worker")) and container.settings.redis.enabled
    if use_worker:
        try:
            result = await run_task_with_timeout(
                "maintenance.full_backup",
                kwargs={
                    "telegram": body.get("telegram"),
                    "rclone": body.get("rclone"),
                    "trigger_type": body.get("trigger_type", "manual"),
                    "triggered_by": body.get("triggered_by", "admin"),
                    "schedule_name": body.get("schedule_name"),
                },
                queue="maintenance",
                timeout_seconds=600,
            )
            return JSONResponse(result)
        except Exception:
            pass

    result = container.backup_service.run_backup_now(
        telegram=body.get("telegram"),
        rclone=body.get("rclone"),
        trigger_type=str(body.get("trigger_type") or "manual"),
        triggered_by=str(body.get("triggered_by") or "admin"),
        schedule_name=(str(body.get("schedule_name")) if body.get("schedule_name") else None),
    )
    return JSONResponse(result)


@router.get("/api/system/backup/history")
async def backup_history(request: Request) -> Any:
    denied = _admin_guard(request)
    if denied:
        return denied
    return JSONResponse({"runs": request.app.state.container.backup_service.list_backups()})


@router.post("/api/system/backup/rclone-config")
async def upload_rclone_config(request: Request, rclone_file: UploadFile = File(...)) -> Any:
    denied = _admin_guard(request)
    if denied:
        return denied
    raw = await rclone_file.read()
    if not raw:
        raise HTTPException(400, "empty rclone.conf")
    result = request.app.state.container.backup_service.upload_rclone_conf(raw)
    return JSONResponse(result, status_code=200 if result.get("ok") else 400)


@router.post("/api/system/backup/rclone/test")
async def test_rclone(request: Request) -> Any:
    denied = _admin_guard(request)
    if denied:
        return denied
    svc = request.app.state.container.backup_service
    body = await _optional_json(request)
    destination = str(body.get("destination") or "").strip()
    mode = str(body.get("mode") or "version").strip().lower()

    if mode == "remotes":
        return JSONResponse(svc.list_rclone_remotes())
    if mode == "destination":
        return JSONResponse(svc.test_rclone_destination(destination or None))
    if mode == "upload":
        return JSONResponse(svc.upload_rclone_test_file(destination or None))
    return JSONResponse(svc.test_rclone())


@router.post("/api/system/backup/telegram/test")
async def test_backup_telegram(request: Request) -> Any:
    denied = _admin_guard(request)
    if denied:
        return denied
    body = await _optional_json(request)
    chat_id = str(body.get("chat_id") or "").strip()
    result = request.app.state.container.backup_service.test_telegram_chat(chat_id=chat_id or None)
    return JSONResponse(result, status_code=200 if result.get("ok") else 400)


@router.post("/api/system/backup/telegram/test-file")
async def test_backup_telegram_file(request: Request) -> Any:
    denied = _admin_guard(request)
    if denied:
        return denied
    body = await _optional_json(request)
    chat_id = str(body.get("chat_id") or "").strip()
    result = request.app.state.container.backup_service.send_telegram_test_file(chat_id=chat_id or None)
    return JSONResponse(result, status_code=200 if result.get("ok") else 400)


@router.get("/api/system/backups")
async def list_backups_alias(request: Request) -> Any:
    denied = _admin_guard(request)
    if denied:
        return denied
    return JSONResponse({"backups": request.app.state.container.backup_service.list_backups()})


# ----- Usage / Quota -----

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
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    cycle = container.usage_cycle_service.reset_cycle(user_id)
    if not cycle:
        return JSONResponse({"error": "Failed to reset cycle"}, status_code=400)
    container.audit_service.log(actor_type="admin", action="usage_cycle_reset", target_type="user", target_id=user_id)
    return JSONResponse({"ok": True, "new_cycle_id": cycle.id})


# ----- System Health -----

@router.get("/api/system/health")
async def system_health(request: Request) -> Any:
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container

    from app.core.db import get_session
    from app.core.models import PaymentRecord, User, UserSubscription

    session = get_session()
    try:
        total_users = session.query(User).count()
        active_users = session.query(User).filter(User.status == "active").count()
        pending_payments = session.query(PaymentRecord).filter(PaymentRecord.status == "pending").count()
        active_subs = session.query(UserSubscription).filter(UserSubscription.status == "active").count()
    finally:
        session.close()

    return JSONResponse(
        {
            "service": "unified-platform",
            "version": "2.0.0",
            "db_type": container.settings.storage.db_type,
            "redis_enabled": container.settings.redis.enabled,
            "users": {"total": total_users, "active": active_users},
            "payments_pending": pending_payments,
            "active_subscriptions": active_subs,
        }
    )


# ----- Server Restart -----

@router.post("/api/system/restart")
async def restart_server(request: Request) -> Any:
    denied = _admin_guard(request)
    if denied:
        return denied

    script = Path(__file__).resolve().parents[4] / "scripts" / "start_backend.sh"
    if not script.exists():
        return JSONResponse({"ok": False, "error": "start script not found"}, status_code=500)

    cmd = (
        f"sleep 2; "
        f"pkill -9 -f 'uvicorn app.main' 2>/dev/null; "
        f"pkill -9 -f 'telegram_bot' 2>/dev/null; "
        f"exec bash {shlex.quote(str(script))}"
    )
    subprocess.Popen(["bash", "-c", cmd], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
    return {"ok": True, "message": "Server restarting..."}
