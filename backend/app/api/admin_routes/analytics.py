from __future__ import annotations
import base64
import os
from pathlib import Path
from datetime import datetime, timezone
from typing import Any
from fastapi import APIRouter, Request, Response
from fastapi.responses import JSONResponse, FileResponse, HTMLResponse
from fastapi.templating import Jinja2Templates
from .utils import _admin_guard, _fmt_dt
from app.core.paths import get_project_root

router = APIRouter(tags=["admin-analytics"])

_PROJECT_ROOT = get_project_root()
_DATASETS_DIR = (_PROJECT_ROOT / "backend" / "datasets").resolve()
_ADMIN_UI_INDEX = (_PROJECT_ROOT / "frontend" / "dist" / "index.html").resolve()
_IGNORED_FAILED_DOMAINS = {"localhost", "127.0.0.1", "ratetest.local"}

# Use absolute path for templates
_TEMPLATE_DIR = Path(__file__).resolve().parents[2] / "templates"
templates = Jinja2Templates(directory=str(_TEMPLATE_DIR))


def _is_not_expired(value: Any) -> bool:
    if not value:
        return True
    if isinstance(value, datetime):
        expires_at = value
    else:
        try:
            expires_at = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except Exception:
            return True
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    return expires_at >= datetime.now(timezone.utc)

async def _collect_datasets_files(container, labels_by_file: dict) -> list[dict[str, str]]:
    datasets_files: list[dict[str, str]] = []
    _DATASETS_DIR.mkdir(parents=True, exist_ok=True)
    image_exts = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif"}
    latest_files = [
        item
        for item in sorted(_DATASETS_DIR.glob("*"), key=lambda p: p.stat().st_mtime, reverse=True)
        if item.is_file() and item.suffix.lower() in image_exts
    ]
    for item in latest_files:
        if not item.is_file():
            continue
        stat = item.stat()
        stem = item.stem
        domain_guess = stem.rsplit("_", 1)[0] if "_" in stem else ""
        domain_lc = domain_guess.lower().strip()
        if domain_lc in _IGNORED_FAILED_DOMAINS or domain_lc.endswith(".local"):
            continue
        ocr_guess = "(decode failed)"
        try:
            payload_base64 = base64.b64encode(item.read_bytes()).decode("ascii")
            solved = await container.solver_service.submit(
                task_type="image",
                payload_base64=payload_base64,
                mode="accurate",
                domain=domain_guess or None,
                field_name="image_default",
            )
            ocr_guess = str(solved.get("result", "")).strip() or "(empty)"
        except Exception:
            ocr_guess = "(decode failed)"
        datasets_files.append(
            {
                "id": item.name,
                "name": item.name,
                "path": str(item),
                "domain": domain_guess or "-",
                "preview_url": f"/admin/datasets/preview/{item.name}",
                "size_kb": f"{max(1, int(stat.st_size / 1024))}",
                "updated_at": datetime.fromtimestamp(stat.st_mtime).strftime("%d-%b-%Y %H:%M"),
                "ocr_guess": ocr_guess[:120],
                "corrected_text": str(labels_by_file.get(item.name, {}).get("corrected_text", "")),
            }
        )
        if len(datasets_files) >= 10:
            break
    return datasets_files

@router.get("/api/bootstrap")
async def admin_bootstrap(request: Request):
    """Lightweight JSON payload for future React admin UI."""
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    try:
        from .captcha_proposals import _repair_approved_proposals

        _repair_approved_proposals(container)
    except Exception:
        pass
    try:
        container.db.delete_revoked_api_keys()
        request.app.state.user_key_service.delete_revoked_keys()
    except Exception:
        pass
    usage = container.db.get_usage_summary()
    labels_by_file = container.db.get_failed_payload_labels()
    api_keys = [
        key for key in container.db.get_all_api_keys()
        if bool(key.get("enabled")) and not key.get("revoked_at") and _is_not_expired(key.get("expires_at"))
    ]
    
    # Merge UserApiKeys from SQLAlchemy
    from app.core.db import get_session
    from app.core.models import UserApiKey, User
    session = get_session()
    try:
        user_keys = (
            session.query(UserApiKey)
            .filter(UserApiKey.status == "active")
            .order_by(UserApiKey.issued_at.desc())
            .all()
        )
        for uk in user_keys:
            if not _is_not_expired(uk.expires_at):
                continue
            user = session.query(User).filter(User.id == uk.user_id).first()
            api_keys.append({
                "id": f"U-{uk.id}",
                "name": f"User: {user.full_name if user else 'Unknown'} ({uk.key_prefix_display})",
                "key_hash": uk.key_hash,
                "enabled": uk.status == "active",
                "expires_at": uk.expires_at,
                "created_at": uk.issued_at,
                "revoked_at": uk.revoked_at,
                "is_master": False,
                "key_type": "user",
            })
    finally:
        session.close()

    for key in api_keys:
        key_id = key["id"]
        key["created_at_display"] = _fmt_dt(key.get("created_at"))
        key["expires_at_display"] = _fmt_dt(key.get("expires_at"))
        key["revoked_at_display"] = _fmt_dt(key.get("revoked_at"))
        if isinstance(key_id, int) or (isinstance(key_id, str) and key_id.isdigit()):
            key["allowed_domains"] = container.db.get_api_key_allowed_domains(int(key_id))
            key["rate_limit"] = container.db.get_api_key_rate_limit(int(key_id)) or {}
            key["device_binding"] = container.db.get_api_key_device_binding(int(key_id))
        else:
            key["allowed_domains"] = []
            key["rate_limit"] = {}
            key["device_binding"] = {}
    datasets_files = await _collect_datasets_files(container, labels_by_file)
    return {
        "usage": usage,
        "global_access": container.db.get_global_access(),
        "allowed_domains": container.db.get_allowed_domains(),
        "model_registry": container.db.get_model_registry(),
        "field_mappings": container.db.get_all_field_mappings(),
        "field_mapping_proposals": container.db.get_pending_field_mapping_proposals(),
        "api_keys": api_keys,
        "datasets_dir": str(_DATASETS_DIR),
        "datasets_files": datasets_files,
        "cloud_backup_configured": bool(os.getenv("BACKUP_CLOUD_UPLOAD_URL", "").strip()),
        "master_key_info": container.db.get_master_key_info(),
    }

@router.get("/", response_class=HTMLResponse)
async def admin_dashboard(request: Request):
    """Render main admin dashboard."""
    denied = _admin_guard(request)
    if denied:
        return denied
    if _ADMIN_UI_INDEX.exists():
        return FileResponse(str(_ADMIN_UI_INDEX))
    return HTMLResponse(content="<h1>Admin UI not built</h1>", status_code=404)


@router.get("/api/exam/stats")
async def get_exam_stats_api(request: Request) -> Any:
    """Get high-level MCQ/exam statistics before the SPA catch-all."""
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    stats = container.db.get_exam_stats()
    return JSONResponse(stats)


@router.get("/api/exam/learning/stats")
async def get_exam_learning_stats_api(request: Request) -> Any:
    """Get self-learning statistics before the SPA catch-all."""
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    db = container.db
    learned_stats = db.get_exam_learned_stats()
    attempt_stats = db.get_exam_attempts_stats()
    learning_enabled = db.get_setting("exam.learning_enabled", "true").lower() in ("true", "1", "yes", "on")
    return JSONResponse({
        "learning_enabled": learning_enabled,
        "learned": learned_stats,
        "attempts": attempt_stats,
    })


@router.post("/api/exam/learning/toggle")
async def toggle_exam_learning_api(request: Request) -> Any:
    """Enable or disable self-learning before the SPA catch-all."""
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    db = container.db
    body = await request.json()
    enabled = str(body.get("enabled", True)).lower() in ("true", "1", "yes", "on")
    db.set_setting("exam.learning_enabled", "true" if enabled else "false")
    return JSONResponse({"learning_enabled": enabled, "message": f"Learning {'enabled' if enabled else 'disabled'}"})


@router.get("/{full_path:path}", response_class=HTMLResponse)
async def admin_spa_fallback(request: Request, full_path: str):
    """Catch-all for SPA client-side routes — serve index.html."""
    denied = _admin_guard(request)
    if denied:
        return denied
    if _ADMIN_UI_INDEX.exists():
        return FileResponse(str(_ADMIN_UI_INDEX))
    return HTMLResponse(content="<h1>Admin UI not built</h1>", status_code=404)


@router.get("/_legacy/api/exam/stats")
async def get_exam_stats(request: Request) -> Any:
    """Get high-level MCQ/exam statistics."""
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    stats = container.db.get_exam_stats()
    return JSONResponse(stats)


@router.get("/_legacy/api/exam/learning/stats")
async def get_exam_learning_stats(request: Request) -> Any:
    """Get self-learning statistics — learned questions, attempts, accuracy."""
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    db = container.db
    
    learned_stats = db.get_exam_learned_stats()
    attempt_stats = db.get_exam_attempts_stats()
    learning_enabled = db.get_setting("exam.learning_enabled", "true").lower() in ("true", "1", "yes", "on")
    
    return JSONResponse({
        "learning_enabled": learning_enabled,
        "learned": learned_stats,
        "attempts": attempt_stats,
    })


@router.post("/_legacy/api/exam/learning/toggle")
async def toggle_exam_learning(request: Request) -> Any:
    """Enable or disable self-learning for exam."""
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    db = container.db
    
    body = await request.json()
    enabled = str(body.get("enabled", True)).lower() in ("true", "1", "yes", "on")
    db.set_setting("exam.learning_enabled", "true" if enabled else "false")
    
    return JSONResponse({"learning_enabled": enabled, "message": f"Learning {'enabled' if enabled else 'disabled'}"})
