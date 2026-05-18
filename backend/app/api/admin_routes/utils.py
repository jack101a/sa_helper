from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
import re
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import quote_plus

from fastapi import Request, Response
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from app.core.paths import get_project_root

_TRUSTED_IDENTITY_HEADERS = (
    "cf-access-authenticated-user-email",
    "x-auth-request-email",
    "x-auth-request-user",
    "x-forwarded-user",
)

def _slug(value: str) -> str:
    normalized = re.sub(r"[^a-zA-Z0-9._-]+", "-", value.strip()).strip("-")
    return normalized or "model"

def _safe_label(value: str) -> str:
    """Conservative token used in labeled dataset filenames."""
    normalized = re.sub(r"[^a-zA-Z0-9]+", "", value.strip())
    return (normalized[:32] or "unknown").lower()

def _default_field_for_task(task_type: str) -> str:
    return f"{task_type}_default"

def _fmt_dt(value: str | None) -> str:
    if not value:
        return "Never"
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed.strftime("%d-%b-%Y %H:%M")
    except Exception:
        return value

def _admin_session_cookie(request: Request) -> str:
    """Create deterministic admin session cookie value."""
    settings = request.app.state.container.settings
    auth_secret = f"{settings.auth.admin_username}:{settings.auth.admin_password}"
    raw = f"{settings.auth.hash_salt}:{auth_secret}".encode()
    return hashlib.sha256(raw).hexdigest()

def _is_request_secure(request: Request) -> bool:
    proto = request.headers.get("x-forwarded-proto", "").strip().lower()
    if proto == "https":
        return True
    if request.url.scheme == "https":
        return True
    return False

def _trusted_admin_identity(request: Request) -> str | None:
    """Return trusted upstream identity when explicitly enabled."""
    enabled = os.getenv("ADMIN_TRUST_PROXY_IDENTITY", "").strip().lower() in {"1", "true", "yes"}
    if not enabled:
        return None
    for header in _TRUSTED_IDENTITY_HEADERS:
        value = request.headers.get(header, "").strip()
        if value:
            return value
    return None

def _admin_guard(request: Request) -> Response | None:
    """Return redirect response when admin auth is missing."""
    trusted_identity = _trusted_admin_identity(request)
    if trusted_identity:
        return None

    settings = request.app.state.container.settings
    has_user_pass = bool((settings.auth.admin_username or "").strip() and settings.auth.admin_password)
    if not has_user_pass:
        return HTMLResponse(
            "Admin auth is not configured. Set ADMIN_USERNAME + ADMIN_PASSWORD.",
            status_code=503,
        )

    cookie_token = request.cookies.get("admin_session", "")
    if cookie_token and hmac.compare_digest(cookie_token, _admin_session_cookie(request)):
        return None

    return RedirectResponse(url="/admin/login", status_code=303)

def _wants_json(request: Request) -> bool:
    if request.headers.get("x-admin-api", "").strip() == "1":
        return True
    return "application/json" in request.headers.get("accept", "").lower()

def _model_upload_error(request: Request, message: str, status_code: int = 400) -> Response:
    if _wants_json(request):
        return JSONResponse(status_code=status_code, content={"ok": False, "message": message})
    return RedirectResponse(
        url=f"/admin/?test_status=error&test_message={quote_plus(message)}",
        status_code=303,
    )

def _model_upload_success(request: Request, message: str, filename_on_disk: str) -> Response:
    if _wants_json(request):
        return JSONResponse(
            status_code=200,
            content={"ok": True, "message": message, "filename": filename_on_disk},
        )
    return RedirectResponse(
        url=f"/admin/?test_status=ok&test_message={quote_plus(message)}",
        status_code=303,
    )

def _write_auto_backup(container, reason: str) -> None:
    """Persist periodic safety snapshot for admin configuration."""
    try:
        _BACKUPS_DIR = (get_project_root() / "backend" / "backups").resolve()
        _BACKUPS_DIR.mkdir(parents=True, exist_ok=True)
        payload = container.db.export_master_setup()
        payload["backup_reason"] = reason
        payload["backup_created_at"] = datetime.now(UTC).isoformat()
        stamp = datetime.now(UTC).strftime("%Y%m%d-%H%M%S")
        snapshot = _BACKUPS_DIR / f"master-setup-{stamp}.json"
        snapshot.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        (_BACKUPS_DIR / "latest-master-setup.json").write_text(json.dumps(payload, indent=2), encoding="utf-8")
        snapshots = sorted(_BACKUPS_DIR.glob("master-setup-*.json"), reverse=True)
        for stale in snapshots[20:]:
            stale.unlink(missing_ok=True)
    except Exception as e:
        logging.exception("auto_backup_failed", extra={"context": {"reason": reason, "error": str(e)}})
