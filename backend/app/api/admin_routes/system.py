"""Admin API — System operations (backup, restore, usage, health)."""

from __future__ import annotations

import html
from typing import Any

import os, signal, subprocess, sys, shlex
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse

from app.workers.dispatch import run_task_with_timeout

from .utils import _admin_guard

router = APIRouter(tags=["admin-system"])


async def _optional_json(request: Request) -> dict[str, Any]:
    try:
        body = await request.json()
        return body if isinstance(body, dict) else {}
    except Exception:
        return {}


def _public_base_url(request: Request) -> str:
    proto = request.headers.get("x-forwarded-proto") or request.url.scheme
    host = request.headers.get("x-forwarded-host") or request.headers.get("host") or request.url.netloc
    return f"{proto}://{host}".rstrip("/")


def _gdrive_callback_uri(request: Request) -> str:
    return f"{_public_base_url(request)}/admin/api/system/backups/gdrive/callback"


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
    if container.settings.redis.enabled:
        try:
            result = await run_task_with_timeout(
                "maintenance.full_backup",
                queue="maintenance",
                timeout_seconds=120,
            )
            return JSONResponse(result)
        except Exception:
            pass

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


@router.post("/api/system/backups/validate")
async def validate_backup_package(request: Request, backup_file: UploadFile = File(...)) -> Any:
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    tmp = Path(container.backup_service._backup_dir) / f"validate-{backup_file.filename or 'upload.upbak'}"
    tmp.write_bytes(await backup_file.read())
    try:
        return JSONResponse(container.backup_service.validate_package(tmp))
    finally:
        tmp.unlink(missing_ok=True)


@router.post("/api/system/backups/restore-package")
async def restore_backup_package(request: Request, backup_file: UploadFile = File(...)) -> Any:
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    filename = backup_file.filename or "uploaded-backup.upbak"
    target = Path(container.backup_service._backup_dir) / filename
    target.write_bytes(await backup_file.read())
    result = container.backup_service.restore_package(target)
    return JSONResponse(result)


@router.post("/api/system/import-bundle")
async def import_system_bundle(request: Request, bundle_file: UploadFile = File(...)) -> Any:
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    filename = bundle_file.filename or "sa-helper-import-bundle.zip"
    target = Path(container.backup_service._backup_dir) / filename
    target.write_bytes(await bundle_file.read())
    result = container.backup_service.import_system_bundle(target)
    return JSONResponse(result, status_code=200 if result.get("status") == "completed" else 400)


@router.post("/api/system/backups/{backup_id}/telegram")
async def upload_backup_to_telegram(request: Request, backup_id: str) -> Any:
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    backup = next((b for b in container.backup_service.list_backups() if b["id"] == backup_id or b["name"] == backup_id), None)
    if not backup:
        raise HTTPException(404, "backup not found")
    ok = container.backup_service.notify_telegram_backup({
        "status": "completed",
        "backup_id": backup["id"],
        "file_path_or_uri": backup["path"],
        "size_bytes": backup["size_bytes"],
        "checksum": container.backup_service._package_checksum(Path(backup["path"])),
    })
    error = "" if ok else container.backup_service._setting("backup.telegram_last_error")
    return JSONResponse({"ok": ok, "error": error}, status_code=200 if ok else 400)


@router.post("/api/system/backups/telegram/test")
async def test_backup_telegram(request: Request) -> Any:
    denied = _admin_guard(request)
    if denied:
        return denied
    body = await _optional_json(request)
    chat_id = str(body.get("chat_id") or "").strip()
    text = str(body.get("text") or "").strip() or None
    save = bool(body.get("save"))
    service = request.app.state.container.backup_service
    if chat_id and save:
        service._set_setting("backup.telegram_channel_id", chat_id)
    result = service.test_telegram_destination(chat_id=chat_id or None, text=text)
    return JSONResponse(result, status_code=200 if result.get("ok") else 400)


@router.get("/api/system/backups/gdrive/auth-url")
async def gdrive_auth_url(request: Request, redirect_uri: str) -> Any:
    denied = _admin_guard(request)
    if denied:
        return denied
    return JSONResponse(request.app.state.container.backup_service.gdrive_auth_url(redirect_uri))


@router.get("/api/system/backups/gdrive/connect")
async def gdrive_connect(request: Request) -> Any:
    denied = _admin_guard(request)
    if denied:
        return denied
    redirect_uri = str(request.query_params.get("redirect_uri") or _gdrive_callback_uri(request))
    result = request.app.state.container.backup_service.gdrive_auth_url(redirect_uri)
    if not result.get("ok"):
        raise HTTPException(400, result.get("error", "Google Drive auth is not configured"))
    return RedirectResponse(result["url"])


@router.get("/api/system/backups/gdrive/callback")
async def gdrive_callback(request: Request, code: str = "", error: str = "") -> Any:
    denied = _admin_guard(request)
    if denied:
        return denied
    if error:
        return HTMLResponse(f"<h1>Google Drive connection failed</h1><p>{html.escape(error)}</p>", status_code=400)
    if not code:
        return HTMLResponse("<h1>Google Drive connection failed</h1><p>Missing authorization code.</p>", status_code=400)
    result = await request.app.state.container.backup_service.gdrive_exchange_code(code, _gdrive_callback_uri(request))
    if not result.get("ok"):
        return HTMLResponse(
            f"<h1>Google Drive connection failed</h1><p>{html.escape(str(result.get('error') or 'unknown error'))}</p>",
            status_code=400,
        )
    return HTMLResponse("<h1>Google Drive connected</h1><p>You can close this tab and return to SA Helper.</p>")


@router.post("/api/system/backups/gdrive/exchange")
async def gdrive_exchange(request: Request) -> Any:
    denied = _admin_guard(request)
    if denied:
        return denied
    body = await request.json()
    code = str(body.get("code") or "")
    redirect_uri = str(body.get("redirect_uri") or "")
    if not code or not redirect_uri:
        raise HTTPException(400, "code and redirect_uri are required")
    result = await request.app.state.container.backup_service.gdrive_exchange_code(code, redirect_uri)
    return JSONResponse(result)


@router.post("/api/system/backups/{backup_id}/gdrive")
async def upload_backup_to_gdrive(request: Request, backup_id: str) -> Any:
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    backup = next((b for b in container.backup_service.list_backups() if b["id"] == backup_id or b["name"] == backup_id), None)
    if not backup:
        raise HTTPException(404, "backup not found")
    return JSONResponse(container.backup_service.upload_to_gdrive(Path(backup["path"])))


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
