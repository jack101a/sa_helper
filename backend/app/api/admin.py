"""Admin dashboard route definitions."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import mimetypes
import os
import re
import shutil
import sqlite3
import urllib.error
import urllib.request
from urllib.parse import quote_plus
from urllib.parse import urlsplit
from datetime import datetime
from pathlib import Path
from fastapi import APIRouter, Request, Form, File, UploadFile, HTTPException
from fastapi.responses import HTMLResponse, RedirectResponse, Response, FileResponse, JSONResponse
from fastapi.templating import Jinja2Templates

router = APIRouter(prefix="/admin", tags=["admin"])

# Use absolute path for templates
_TEMPLATE_DIR = Path(__file__).resolve().parent.parent / "templates"
templates = Jinja2Templates(directory=str(_TEMPLATE_DIR))
_PROJECT_ROOT = Path(__file__).resolve().parents[3]
_DATASETS_DIR = (_PROJECT_ROOT / "backend" / "datasets").resolve()
_MODELS_DIR = (_PROJECT_ROOT / "backend" / "models").resolve()
_BACKUPS_DIR = (_PROJECT_ROOT / "backend" / "backups").resolve()
_ADMIN_UI_INDEX = (_PROJECT_ROOT / "backend" / "admin-ui" / "dist" / "index.html").resolve()
_IGNORED_FAILED_DOMAINS = {"localhost", "127.0.0.1", "ratetest.local"}
_TRUSTED_IDENTITY_HEADERS = (
    "cf-access-authenticated-user-email",
    "x-auth-request-email",
    "x-auth-request-user",
    "x-forwarded-user",
)


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


def _slug(value: str) -> str:
    normalized = re.sub(r"[^a-zA-Z0-9._-]+", "-", value.strip()).strip("-")
    return normalized or "model"


def _safe_label(value: str) -> str:
    """Conservative token used in labeled dataset filenames."""
    normalized = re.sub(r"[^a-zA-Z0-9]+", "", value.strip())
    return (normalized[:32] or "unknown").lower()


def _field_key(task_type: str, source_selector: str, target_selector: str) -> str:
    base = f"{task_type}|{source_selector}|{target_selector}"
    digest = hashlib.sha1(base.encode("utf-8")).hexdigest()[:10]
    return f"{task_type}_{digest}"


def _normalize_domain(domain: str) -> str:
    token = str(domain or "").strip().lower()
    if not token:
        return ""
    if "://" in token:
        try:
            token = urlsplit(token).hostname or token
        except Exception:
            pass
    token = token.split("/", 1)[0].split(":", 1)[0].strip(".")
    if token.startswith("www."):
        token = token[4:]
    return token


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
    raw = f"{settings.auth.hash_salt}:{auth_secret}".encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def _is_request_secure(request: Request) -> bool:
    proto = request.headers.get("x-forwarded-proto", "").strip().lower()
    if proto == "https":
        return True
    if request.url.scheme == "https":
        return True
    host = request.headers.get("host", "").strip().lower()
    if host and not host.startswith("localhost") and not host.startswith("127.0.0.1"):
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
        _BACKUPS_DIR.mkdir(parents=True, exist_ok=True)
        payload = container.db.export_master_setup()
        payload["backup_reason"] = reason
        payload["backup_created_at"] = datetime.utcnow().isoformat() + "Z"
        stamp = datetime.utcnow().strftime("%Y%m%d-%H%M%S")
        snapshot = _BACKUPS_DIR / f"master-setup-{stamp}.json"
        snapshot.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        (_BACKUPS_DIR / "latest-master-setup.json").write_text(json.dumps(payload, indent=2), encoding="utf-8")
        snapshots = sorted(_BACKUPS_DIR.glob("master-setup-*.json"), reverse=True)
        for stale in snapshots[20:]:
            stale.unlink(missing_ok=True)
    except Exception:
        # Backups are best-effort and should never block admin workflows.
        pass


@router.get("/api/bootstrap")
async def admin_bootstrap(request: Request):
    """Lightweight JSON payload for future React admin UI."""
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    usage = container.db.get_usage_summary()
    labels_by_file = container.db.get_failed_payload_labels()
    api_keys = container.db.get_all_api_keys()
    for key in api_keys:
        key_id = int(key["id"])
        key["created_at_display"] = _fmt_dt(key.get("created_at"))
        key["expires_at_display"] = _fmt_dt(key.get("expires_at"))
        key["revoked_at_display"] = _fmt_dt(key.get("revoked_at"))
        key["allowed_domains"] = container.db.get_api_key_allowed_domains(key_id)
        key["rate_limit"] = container.db.get_api_key_rate_limit(key_id) or {}
        key["device_binding"] = container.db.get_api_key_device_binding(key_id)
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
    }


@router.post("/api/keys/create")
async def api_create_key(
    request: Request,
    key_name: str = Form(...),
    expiry_days: int = Form(30),
    all_domains: str = Form("on"),
    allowed_domains_csv: str = Form(""),
    requests_per_minute: int = Form(0),
    burst: int = Form(0),
):
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    key_id, plain, expires = container.key_service.create_key(name=key_name, expiry_days=expiry_days)
    allow_all = str(all_domains).lower() in {"1", "true", "on", "yes"}
    domains = [d.strip() for d in str(allowed_domains_csv or "").split(",") if d.strip()]
    container.db.set_api_key_domain_scope(key_id=key_id, all_domains=allow_all, domains=domains)
    if int(requests_per_minute or 0) > 0:
        container.db.set_api_key_rate_limit(
            key_id=key_id,
            requests_per_minute=int(requests_per_minute),
            burst=int(burst or 0),
        )
    _write_auto_backup(container, "api_create_key")
    # WhatsApp admin notification
    container.alert_service.notify_new_key(key_name=key_name, expires_at=expires)
    return {"ok": True, "key_id": key_id, "api_key": plain, "expires_at": expires}


@router.get("/login", response_class=HTMLResponse)
async def admin_login_page(request: Request):
    """Render admin login form."""
    settings = request.app.state.container.settings
    return templates.TemplateResponse(
        "admin_login.html",
        {
            "request": request,
            "error": "",
            "enable_password_login": bool((settings.auth.admin_username or "").strip() and settings.auth.admin_password),
            "enable_proxy_sso": os.getenv("ADMIN_TRUST_PROXY_IDENTITY", "").strip().lower() in {"1", "true", "yes"},
        },
    )


@router.post("/login")
async def admin_login_submit(
    request: Request,
    admin_username: str = Form(""),
    admin_password: str = Form(""),
):
    """Validate admin credentials and start session."""
    settings = request.app.state.container.settings
    has_user_pass = bool((settings.auth.admin_username or "").strip() and settings.auth.admin_password)

    if not has_user_pass:
        return templates.TemplateResponse(
            "admin_login.html",
            {
                "request": request,
                "error": "Admin auth is not configured on server.",
                "enable_password_login": has_user_pass,
                "enable_proxy_sso": os.getenv("ADMIN_TRUST_PROXY_IDENTITY", "").strip().lower() in {"1", "true", "yes"},
            },
            status_code=503,
        )

    user_pass_ok = bool(
        has_user_pass
        and admin_username
        and admin_password
        and hmac.compare_digest(admin_username, settings.auth.admin_username)
        and hmac.compare_digest(admin_password, settings.auth.admin_password)
    )

    if not user_pass_ok:
        return templates.TemplateResponse(
            "admin_login.html",
            {
                "request": request,
                "error": "Invalid credentials.",
                "enable_password_login": has_user_pass,
                "enable_proxy_sso": os.getenv("ADMIN_TRUST_PROXY_IDENTITY", "").strip().lower() in {"1", "true", "yes"},
            },
            status_code=401,
        )
    response = RedirectResponse(url="/admin/", status_code=303)
    secure_cookie = _is_request_secure(request)
    cookie_domain = os.getenv("ADMIN_SESSION_COOKIE_DOMAIN", "").strip() or None
    response.set_cookie(
        key="admin_session",
        value=_admin_session_cookie(request),
        httponly=True,
        samesite=("none" if secure_cookie else "lax"),
        secure=secure_cookie,
        domain=cookie_domain,
        path="/",
        max_age=60 * 60 * 12,
    )
    return response


@router.post("/logout")
async def admin_logout():
    """Clear admin session cookie."""
    response = RedirectResponse(url="/admin/login", status_code=303)
    response.delete_cookie("admin_session")
    return response


@router.get("/", response_class=HTMLResponse)
async def admin_dashboard(request: Request):
    """Render main admin dashboard."""
    denied = _admin_guard(request)
    if denied:
        return denied
    if _ADMIN_UI_INDEX.exists():
        return FileResponse(str(_ADMIN_UI_INDEX))
    container = request.app.state.container

    usage = container.db.get_usage_summary()
    global_access = container.db.get_global_access()
    allowed_domains = container.db.get_allowed_domains()
    model_routes = container.db.get_all_model_routes()
    model_registry = container.db.get_model_registry()
    field_mappings = container.db.get_all_field_mappings()
    field_mapping_proposals = container.db.get_pending_field_mapping_proposals()
    labels_by_file = container.db.get_failed_payload_labels()

    # Get all API keys for management
    all_keys = container.db.get_all_api_keys()
    for key in all_keys:
        key["created_at_display"] = _fmt_dt(key.get("created_at"))
        key["expires_at_display"] = _fmt_dt(key.get("expires_at"))
        key["revoked_at_display"] = _fmt_dt(key.get("revoked_at"))

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

    test_status = request.query_params.get("test_status", "")
    test_message = request.query_params.get("test_message", "")

    return templates.TemplateResponse("admin.html", {
        "request": request,
        "usage": usage,
        "global_access": global_access,
        "allowed_domains": allowed_domains,
        "model_routes": model_routes,
        "model_registry": model_registry,
        "field_mappings": field_mappings,
        "field_mapping_proposals": field_mapping_proposals,
        "api_keys": all_keys,
        "datasets_dir": str(_DATASETS_DIR),
        "datasets_files": datasets_files,
        "test_status": test_status,
        "test_message": test_message,
    })


@router.post("/access")
async def update_access(request: Request, global_access: str = Form(None), new_domain: str = Form(None)):
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    container.db.set_global_access(global_access == "on")
    if new_domain and new_domain.strip():
        container.db.add_allowed_domain(new_domain.strip())
    _write_auto_backup(container, "update_access")
    return RedirectResponse(url="/admin/", status_code=303)


@router.post("/access/remove")
async def remove_domain(request: Request, domain: str = Form(...)):
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    container.db.remove_allowed_domain(domain)
    _write_auto_backup(container, "remove_domain")
    return RedirectResponse(url="/admin/", status_code=303)


@router.post("/routes")
async def update_route(request: Request, domain: str = Form(...), ai_model_filename: str = Form(...)):
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    container.db.set_model_route(domain, ai_model_filename)
    return RedirectResponse(url="/admin/", status_code=303)


@router.post("/models/upload")
async def upload_model(
    request: Request,
    ai_model_file: UploadFile | None = File(None),
    legacy_upload_file: UploadFile | None = File(None, alias="model_file"),
    file: UploadFile | None = File(None),
    ai_model_name: str = Form(""),
    legacy_model_name: str = Form("", alias="model_name"),
    version: str = Form("v1"),
    task_type: str = Form("image"),
    runtime: str = Form("onnx"),
    notes: str = Form(""),
):
    denied = _admin_guard(request)
    if denied:
        return denied
    if runtime not in {"onnx"}:
        return _model_upload_error(request, "Runtime must be ONNX")
    if task_type not in {"image", "audio", "text"}:
        return _model_upload_error(request, "Task type must be image/audio/text")

    container = request.app.state.container
    filename_on_disk = ""
    uploaded_file = ai_model_file or legacy_upload_file or file
    clean_model_name = (ai_model_name or "").strip() or (legacy_model_name or "").strip()
    clean_version = version.strip() or "v1"
    clean_notes = notes.strip() or None

    if not clean_model_name:
        return _model_upload_error(request, "Model name is required")

    if not uploaded_file or not uploaded_file.filename:
        return _model_upload_error(request, "Model file is required")
    suffix = Path(uploaded_file.filename).suffix.lower()
    if suffix != ".onnx":
        return _model_upload_error(request, "Only .onnx uploads are supported")
    _MODELS_DIR.mkdir(parents=True, exist_ok=True)
    base_filename = f"{_slug(clean_model_name)}_{_slug(clean_version)}.onnx"
    filename_on_disk = base_filename
    candidate = _MODELS_DIR / filename_on_disk
    n = 2
    while candidate.exists():
        filename_on_disk = f"{_slug(clean_model_name)}_{_slug(clean_version)}_{n}.onnx"
        candidate = _MODELS_DIR / filename_on_disk
        n += 1
    target = _MODELS_DIR / filename_on_disk
    bytes_written = 0
    try:
        with target.open("wb") as out_f:
            while True:
                chunk = await uploaded_file.read(1024 * 1024)
                if not chunk:
                    break
                out_f.write(chunk)
                bytes_written += len(chunk)
        await uploaded_file.close()
    except Exception as exc:
        try:
            target.unlink(missing_ok=True)
        except Exception:
            pass
        return _model_upload_error(request, f"Failed to write model file: {exc}", status_code=500)

    if bytes_written <= 0:
        target.unlink(missing_ok=True)
        return _model_upload_error(request, "Uploaded file is empty")

    try:
        container.db.add_model_registry_entry(
            ai_model_name=clean_model_name,
            version=clean_version,
            task_type=task_type,
            ai_runtime=runtime,
            ai_model_filename=filename_on_disk,
            notes=clean_notes,
            status="active",
            lifecycle_state="candidate",
        )
    except sqlite3.IntegrityError as exc:
        return _model_upload_error(request, "Model filename already exists")
    except Exception as exc:
        return _model_upload_error(request, f"Upload failed: {exc}", status_code=500)
    _write_auto_backup(container, "upload_model")
    return _model_upload_success(
        request,
        message=f"Model uploaded: {filename_on_disk}",
        filename_on_disk=filename_on_disk,
    )


@router.post("/models/remove")
async def remove_model(request: Request, ai_model_id: int = Form(...)):
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    entry = container.db.get_model_registry_entry(ai_model_id)
    if entry:
        runtime = entry.get("ai_runtime")
        filename = entry.get("ai_model_filename")
        if runtime == "onnx" and filename:
            target = _MODELS_DIR / str(filename)
            if target.exists():
                target.unlink(missing_ok=True)
        container.db.delete_model_registry_entry(ai_model_id)
        _write_auto_backup(container, "remove_model")
    return RedirectResponse(url="/admin/", status_code=303)


@router.post("/models/update")
async def update_model(
    request: Request,
    ai_model_id: int = Form(...),
    ai_model_name: str = Form(...),
    version: str = Form("v1"),
    task_type: str = Form("image"),
    lifecycle_state: str = Form("candidate"),
    notes: str = Form(""),
):
    denied = _admin_guard(request)
    if denied:
        return denied
    if task_type not in {"image", "audio", "text"}:
        raise HTTPException(status_code=400, detail="task_type must be image|audio|text")
    if lifecycle_state not in {"candidate", "staging", "production", "rolled_back"}:
        raise HTTPException(status_code=400, detail="invalid lifecycle_state")
    container = request.app.state.container
    container.db.update_model_registry_entry(
        ai_model_id=ai_model_id,
        ai_model_name=ai_model_name.strip(),
        version=version.strip() or "v1",
        task_type=task_type,
        notes=(notes.strip() or None),
        lifecycle_state=lifecycle_state,
    )
    _write_auto_backup(container, "update_model")
    return RedirectResponse(url="/admin/", status_code=303)


@router.post("/mappings/set")
async def set_mapping(
    request: Request,
    domain: str = Form(...),
    field_name: str = Form(""),
    field_key: str = Form(""),
    task_type: str = Form(""),
    source_data_type: str = Form("image"),
    source_selector: str = Form(""),
    target_data_type: str = Form("text"),
    target_selector: str = Form(""),
    ai_model_id: int = Form(...),
):
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    effective_task = (source_data_type or task_type or "").strip().lower()
    if effective_task not in {"image", "audio", "text"}:
        raise HTTPException(status_code=400, detail="task_type must be image|audio|text")
    clean_source_selector = source_selector.strip()
    clean_target_selector = target_selector.strip()
    clean_field = _default_field_for_task(effective_task)
    clean_domain = _normalize_domain(domain)
    if not clean_domain:
        raise HTTPException(status_code=400, detail="domain is required")
    container.db.set_field_mapping(
        domain=clean_domain,
        field_name=clean_field,
        task_type=effective_task,
        source_data_type=effective_task,
        source_selector=clean_source_selector,
        target_data_type=target_data_type.strip() or "text",
        target_selector=clean_target_selector,
        ai_model_id=ai_model_id,
    )
    _write_auto_backup(container, "set_mapping")
    return RedirectResponse(url="/admin/", status_code=303)


@router.post("/mappings/update")
async def update_mapping(
    request: Request,
    mapping_id: int = Form(...),
    domain: str = Form(...),
    field_name: str = Form(""),
    field_key: str = Form(""),
    task_type: str = Form(""),
    source_data_type: str = Form("image"),
    source_selector: str = Form(""),
    target_data_type: str = Form("text"),
    target_selector: str = Form(""),
    ai_model_id: int = Form(...),
):
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    effective_task = (source_data_type or task_type or "").strip().lower()
    if effective_task not in {"image", "audio", "text"}:
        raise HTTPException(status_code=400, detail="task_type must be image|audio|text")
    clean_source_selector = source_selector.strip()
    clean_target_selector = target_selector.strip()
    clean_field = _default_field_for_task(effective_task)
    clean_domain = _normalize_domain(domain)
    if not clean_domain:
        raise HTTPException(status_code=400, detail="domain is required")
    container.db.update_field_mapping(
        mapping_id=mapping_id,
        domain=clean_domain,
        field_name=clean_field,
        task_type=effective_task,
        source_data_type=effective_task,
        source_selector=clean_source_selector,
        target_data_type=target_data_type.strip() or "text_input",
        target_selector=clean_target_selector,
        ai_model_id=ai_model_id,
    )
    _write_auto_backup(container, "update_mapping")
    return RedirectResponse(url="/admin/", status_code=303)


@router.post("/mappings/domain/update")
async def update_mapping_domain(
    request: Request,
    old_domain: str = Form(...),
    new_domain: str = Form(...),
):
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    clean_old = _normalize_domain(old_domain)
    clean_new = _normalize_domain(new_domain)
    if not clean_old or not clean_new:
        raise HTTPException(status_code=400, detail="old_domain and new_domain are required")
    try:
        updated = container.db.rename_domain_mappings(clean_old, clean_new)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if updated <= 0:
        raise HTTPException(status_code=404, detail="no mappings found for domain")
    _write_auto_backup(container, "rename_mapping_domain")
    return RedirectResponse(url="/admin/", status_code=303)


@router.post("/mappings/domain/assign-model")
async def assign_model_to_domain(
    request: Request,
    domain: str = Form(...),
    ai_model_id: int = Form(...),
):
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    updated = container.db.assign_model_to_domain(domain=domain, ai_model_id=ai_model_id)
    if updated <= 0:
        raise HTTPException(status_code=400, detail="no matching mappings found for selected model task type")
    _write_auto_backup(container, "assign_model_to_domain")
    return RedirectResponse(url="/admin/", status_code=303)


@router.post("/mappings/remove")
async def remove_mapping(request: Request, mapping_id: int = Form(...)):
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    container.db.remove_field_mapping(mapping_id)
    _write_auto_backup(container, "remove_mapping")
    return RedirectResponse(url="/admin/", status_code=303)


@router.post("/labels/submit")
async def submit_label(request: Request, sample_id: int = Form(...), label_text: str = Form(...)):
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    key_record = getattr(request.state, "api_key_record", None)
    labeled_by = int(key_record["id"]) if key_record else None
    if not label_text.strip():
        raise HTTPException(status_code=400, detail="label_text is required")
    container.db.label_retrain_sample(sample_id, label_text.strip(), labeled_by=labeled_by)
    return RedirectResponse(url="/admin/", status_code=303)


@router.post("/labels/reject")
async def reject_label(request: Request, sample_id: int = Form(...)):
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    key_record = getattr(request.state, "api_key_record", None)
    labeled_by = int(key_record["id"]) if key_record else None
    container.db.reject_retrain_sample(sample_id, labeled_by=labeled_by)
    return RedirectResponse(url="/admin/", status_code=303)


@router.post("/retrain/schedule")
async def schedule_retrain(request: Request, min_samples: int = Form(20), notes: str = Form("")):
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    key_record = getattr(request.state, "api_key_record", None)
    requested_by = int(key_record["id"]) if key_record else None
    min_samples = max(1, min_samples)
    container.db.create_retrain_job(
        requested_by=requested_by,
        min_samples=min_samples,
        notes=(notes.strip() or None),
    )
    return RedirectResponse(url="/admin/", status_code=303)


@router.get("/datasets/file/{filename}")
async def download_dataset_file(request: Request, filename: str):
    denied = _admin_guard(request)
    if denied:
        return denied
    safe = os.path.basename(filename)
    target = (_DATASETS_DIR / safe).resolve()
    if target.parent != _DATASETS_DIR.resolve() or not target.exists() or not target.is_file():
        raise HTTPException(status_code=404, detail="file not found")
    media_type = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
    return Response(content=target.read_bytes(), media_type=media_type, headers={
        "Content-Disposition": f'attachment; filename="{safe}"'
    })


@router.get("/datasets/preview/{filename}")
async def preview_dataset_file(request: Request, filename: str):
    denied = _admin_guard(request)
    if denied:
        return denied
    safe = os.path.basename(filename)
    target = (_DATASETS_DIR / safe).resolve()
    if target.parent != _DATASETS_DIR.resolve() or not target.exists() or not target.is_file():
        raise HTTPException(status_code=404, detail="file not found")
    media_type = mimetypes.guess_type(target.name)[0] or "image/png"
    return Response(content=target.read_bytes(), media_type=media_type)


@router.post("/datasets/label")
async def save_failed_payload_label(
    request: Request,
    filename: str = Form(...),
    domain: str = Form(""),
    ai_guess: str = Form(""),
    corrected_text: str = Form(...),
):
    denied = _admin_guard(request)
    if denied:
        return denied
    safe = os.path.basename(filename)
    target = (_DATASETS_DIR / safe).resolve()
    if target.parent != _DATASETS_DIR.resolve() or not target.exists() or not target.is_file():
        raise HTTPException(status_code=404, detail="file not found")
    clean_corrected = corrected_text.strip()
    if not clean_corrected:
        raise HTTPException(status_code=400, detail="corrected_text is required")
    container = request.app.state.container
    container.db.upsert_failed_payload_label(
        filename=safe,
        domain=domain.strip() or "unknown",
        ai_guess=ai_guess.strip() or None,
        corrected_text=clean_corrected,
    )
    labeled_dir = (_DATASETS_DIR / "labeled").resolve()
    labeled_dir.mkdir(parents=True, exist_ok=True)
    label_token = _safe_label(clean_corrected)
    candidate_name = f"{label_token}{target.suffix.lower()}"
    labeled_path = (labeled_dir / candidate_name).resolve()
    if labeled_path.parent != labeled_dir:
        raise HTTPException(status_code=400, detail="invalid labeled target path")
    n = 2
    while labeled_path.exists():
        candidate_name = f"{label_token}_{n}{target.suffix.lower()}"
        labeled_path = (labeled_dir / candidate_name).resolve()
        n += 1
    shutil.move(str(target), str(labeled_path))
    return RedirectResponse(url="/admin/?test_status=ok&test_message=Correction+saved+and+moved+to+labeled+dataset", status_code=303)


@router.get("/datasets/label")
async def datasets_label_get_redirect(request: Request):
    denied = _admin_guard(request)
    if denied:
        return denied
    return RedirectResponse(url="/admin/?test_status=error&test_message=Use+Save+button+to+submit+correction", status_code=303)


@router.post("/datasets/ignore")
async def ignore_failed_payload(
    request: Request,
    filename: str = Form(...),
):
    denied = _admin_guard(request)
    if denied:
        return denied
    safe = os.path.basename(filename)
    target = (_DATASETS_DIR / safe).resolve()
    if target.parent != _DATASETS_DIR.resolve() or not target.exists() or not target.is_file():
        raise HTTPException(status_code=404, detail="file not found")
    ignored_dir = (_DATASETS_DIR / "ignored").resolve()
    ignored_dir.mkdir(parents=True, exist_ok=True)
    ignored_target = (ignored_dir / safe).resolve()
    if ignored_target.parent != ignored_dir:
        raise HTTPException(status_code=400, detail="invalid ignored target path")
    n = 2
    stem = Path(safe).stem
    suffix = Path(safe).suffix
    while ignored_target.exists():
        ignored_target = (ignored_dir / f"{stem}_{n}{suffix}").resolve()
        n += 1
    shutil.move(str(target), str(ignored_target))
    return RedirectResponse(url="/admin/?test_status=ok&test_message=Failed+payload+ignored", status_code=303)


@router.get("/datasets/ignore")
async def datasets_ignore_get_redirect(request: Request):
    denied = _admin_guard(request)
    if denied:
        return denied
    return RedirectResponse(url="/admin/?test_status=error&test_message=Use+Ignore+button+to+submit+ignore+action", status_code=303)


@router.get("/export/field-mappings.json")
async def export_field_mappings(request: Request):
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    payload = {
        "exported_at": datetime.utcnow().isoformat() + "Z",
        "field_mappings": container.db.get_all_field_mappings(),
    }
    return Response(
        content=json.dumps(payload, indent=2),
        media_type="application/json",
        headers={"Content-Disposition": 'attachment; filename="field-mappings-export.json"'},
    )


@router.get("/export/datasets.json")
async def export_datasets_metadata(request: Request):
    denied = _admin_guard(request)
    if denied:
        return denied
    files = []
    _DATASETS_DIR.mkdir(parents=True, exist_ok=True)
    for item in sorted(_DATASETS_DIR.glob("*"), key=lambda p: p.stat().st_mtime, reverse=True):
        if not item.is_file():
            continue
        stat = item.stat()
        files.append(
            {
                "filename": item.name,
                "path": str(item),
                "size_bytes": int(stat.st_size),
                "updated_at": datetime.fromtimestamp(stat.st_mtime).isoformat(),
            }
        )
    payload = {"exported_at": datetime.utcnow().isoformat() + "Z", "datasets": files}
    return Response(
        content=json.dumps(payload, indent=2),
        media_type="application/json",
        headers={"Content-Disposition": 'attachment; filename="datasets-metadata-export.json"'},
    )


@router.get("/export/master-setup.json")
async def export_master_setup(request: Request):
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    payload = container.db.export_master_setup()
    return Response(
        content=json.dumps(payload, indent=2),
        media_type="application/json",
        headers={"Content-Disposition": 'attachment; filename="master-setup-export.json"'},
    )


@router.post("/backups/create")
async def create_backup_now(request: Request):
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    _write_auto_backup(container, "manual_backup")
    if _wants_json(request):
        return JSONResponse(status_code=200, content={"ok": True})
    return RedirectResponse(url="/admin/?test_status=ok&test_message=Backup+created", status_code=303)


@router.get("/backups")
async def list_backups(request: Request):
    denied = _admin_guard(request)
    if denied:
        return denied
    _BACKUPS_DIR.mkdir(parents=True, exist_ok=True)
    backups = []
    for item in sorted(_BACKUPS_DIR.glob("master-setup-*.json"), reverse=True):
        stat = item.stat()
        backups.append(
            {
                "name": item.name,
                "size_bytes": int(stat.st_size),
                "updated_at": datetime.fromtimestamp(stat.st_mtime).isoformat(),
            }
        )
    return {"backups": backups}


@router.post("/backups/restore-latest")
async def restore_latest_backup(request: Request):
    denied = _admin_guard(request)
    if denied:
        return denied
    latest = _BACKUPS_DIR / "latest-master-setup.json"
    if not latest.exists():
        raise HTTPException(status_code=404, detail="latest backup not found")
    payload = json.loads(latest.read_text(encoding="utf-8"))
    container = request.app.state.container
    container.db.import_master_setup(payload)
    _write_auto_backup(container, "restore_latest_backup")
    if _wants_json(request):
        return JSONResponse(status_code=200, content={"ok": True, "message": "Latest backup restored"})
    return RedirectResponse(url="/admin/?test_status=ok&test_message=Latest+backup+restored", status_code=303)


@router.post("/backups/cloud/push")
async def push_cloud_backup(request: Request):
    denied = _admin_guard(request)
    if denied:
        return denied
    upload_url = os.getenv("BACKUP_CLOUD_UPLOAD_URL", "").strip()
    if not upload_url:
        raise HTTPException(status_code=400, detail="cloud backup upload url not configured")
    token = os.getenv("BACKUP_CLOUD_TOKEN", "").strip()
    container = request.app.state.container
    payload = container.db.export_master_setup()
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(upload_url, data=body, method="POST")
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            if resp.status >= 400:
                raise HTTPException(status_code=502, detail=f"cloud backup failed ({resp.status})")
    except urllib.error.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"cloud backup failed ({exc.code})") from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"cloud backup failed: {exc}") from exc
    _write_auto_backup(container, "cloud_backup_push")
    return JSONResponse(status_code=200, content={"ok": True})


@router.post("/backups/cloud/pull")
async def pull_cloud_backup(request: Request):
    denied = _admin_guard(request)
    if denied:
        return denied
    download_url = os.getenv("BACKUP_CLOUD_DOWNLOAD_URL", "").strip()
    if not download_url:
        raise HTTPException(status_code=400, detail="cloud backup download url not configured")
    token = os.getenv("BACKUP_CLOUD_TOKEN", "").strip()
    req = urllib.request.Request(download_url, method="GET")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            body = resp.read()
            payload = json.loads(body.decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"cloud restore failed ({exc.code})") from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"cloud restore failed: {exc}") from exc
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="cloud payload invalid")
    container = request.app.state.container
    container.db.import_master_setup(payload)
    _write_auto_backup(container, "cloud_backup_pull")
    return JSONResponse(status_code=200, content={"ok": True})


@router.post("/import/master-setup")
async def import_master_setup(
    request: Request,
    setup_file: UploadFile = File(...),
):
    denied = _admin_guard(request)
    if denied:
        return denied
    try:
        raw = await setup_file.read()
        payload = json.loads(raw.decode("utf-8"))
        if not isinstance(payload, dict):
            raise ValueError("Invalid setup JSON")
    except Exception as exc:
        if _wants_json(request):
            return JSONResponse(status_code=400, content={"ok": False, "message": f"invalid setup file: {exc}"})
        raise HTTPException(status_code=400, detail=f"invalid setup file: {exc}") from exc
    container = request.app.state.container
    container.db.import_master_setup(payload)
    _write_auto_backup(container, "import_master_setup")
    if _wants_json(request):
        return JSONResponse(status_code=200, content={"ok": True, "message": "Master setup imported"})
    return RedirectResponse(url="/admin/?test_status=ok&test_message=Master+setup+imported", status_code=303)


@router.post("/mappings/test")
async def test_mapping(request: Request, mapping_id: int = Form(...)):
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    mapping = next((m for m in container.db.get_all_field_mappings() if int(m["id"]) == mapping_id), None)
    if not mapping:
        return RedirectResponse(url="/admin/?test_status=error&test_message=Mapping+not+found", status_code=303)
    if not mapping.get("ai_model_name") or not mapping.get("ai_model_filename"):
        return RedirectResponse(
            url="/admin/?test_status=error&test_message=Mapping+has+no+active+model+assigned",
            status_code=303,
        )
    if str(mapping.get("ai_runtime")) != "onnx":
        return RedirectResponse(
            url="/admin/?test_status=error&test_message=Mapping+runtime+must+be+onnx",
            status_code=303,
        )
    model_filename = str(mapping.get("ai_model_filename") or "").strip()
    if not model_filename:
        return RedirectResponse(
            url="/admin/?test_status=error&test_message=Mapping+has+no+model+filename",
            status_code=303,
        )
    model_file = _MODELS_DIR / model_filename
    if not model_file.exists():
        return RedirectResponse(
            url=f"/admin/?test_status=error&test_message={quote_plus(f'Registered model file not found on disk: {model_filename}. Re-upload this model in Model Registry.')}",
            status_code=303,
        )

    prefix = f"{mapping['domain']}_"
    files = [p for p in _DATASETS_DIR.glob(f"{prefix}*") if p.is_file()]
    if not files:
        return RedirectResponse(
            url=f"/admin/?test_status=error&test_message={quote_plus('No dataset sample file found for this domain')}",
            status_code=303,
        )
    latest = sorted(files, key=lambda p: p.stat().st_mtime, reverse=True)[0]
    raw = latest.read_bytes()
    payload_base64 = base64.b64encode(raw).decode("ascii")

    try:
        solved = await container.solver_service.submit(
            task_type=mapping["task_type"],
            payload_base64=payload_base64,
            mode="accurate",
            domain=mapping["domain"],
            field_name=mapping["field_name"],
        )
        preview = str(solved.get("result", ""))[:80]
        used = str(solved.get("model_used", "-"))
        msg = f"model={used} | result={preview}"
        return RedirectResponse(
            url=f"/admin/?test_status=ok&test_message={quote_plus(msg)}",
            status_code=303,
        )
    except Exception as exc:
        return RedirectResponse(
            url=f"/admin/?test_status=error&test_message={quote_plus(str(exc))}",
            status_code=303,
        )


@router.post("/models/promote")
async def promote_model(request: Request, ai_model_id: int = Form(...), lifecycle_state: str = Form(...)):
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    key_record = getattr(request.state, "api_key_record", None)
    changed_by = int(key_record["id"]) if key_record else None
    if lifecycle_state not in {"candidate", "staging", "production"}:
        raise HTTPException(status_code=400, detail="invalid lifecycle_state")
    target = container.db.get_model_registry_entry(ai_model_id)
    if not target:
        raise HTTPException(status_code=404, detail="model not found")
    container.db.set_lifecycle_state(
        ai_model_id=ai_model_id,
        to_state=lifecycle_state,
        changed_by=changed_by,
        reason="Promoted from admin dashboard",
    )
    return RedirectResponse(url="/admin/", status_code=303)


@router.post("/models/rollback")
async def rollback_model(request: Request, ai_model_id: int = Form(...)):
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    key_record = getattr(request.state, "api_key_record", None)
    changed_by = int(key_record["id"]) if key_record else None
    current = container.db.get_model_registry_entry(ai_model_id)
    if not current:
        raise HTTPException(status_code=404, detail="model not found")

    container.db.set_lifecycle_state(
        ai_model_id=ai_model_id,
        to_state="rolled_back",
        changed_by=changed_by,
        reason="Manual rollback requested",
    )
    fallback = container.db.get_latest_model_by_state(
        task_type=current["task_type"],
        lifecycle_state="staging",
        exclude_id=ai_model_id,
    ) or container.db.get_latest_model_by_state(
        task_type=current["task_type"],
        lifecycle_state="candidate",
        exclude_id=ai_model_id,
    )
    if fallback:
        container.db.set_lifecycle_state(
            ai_model_id=int(fallback["id"]),
            to_state="production",
            changed_by=changed_by,
            reason=f"Promoted during rollback of model {ai_model_id}",
        )
    return RedirectResponse(url="/admin/", status_code=303)


@router.post("/keys/create")
async def create_key(request: Request, key_name: str = Form(...), expiry_days: int = Form(30)):
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    _key_id, plain, expires = container.key_service.create_key(name=key_name, expiry_days=expiry_days)
    # Flash the key so user can copy it
    return templates.TemplateResponse("key_created.html", {
        "request": request,
        "api_key": plain,
        "key_name": key_name,
        "expires_at": expires,
    })


@router.post("/keys/access/update")
async def update_key_access(
    request: Request,
    key_id: int = Form(...),
    all_domains: str = Form("on"),
    allowed_domains_csv: str = Form(""),
):
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    allow_all = str(all_domains).lower() in {"1", "true", "on", "yes"}
    domains = [d.strip() for d in str(allowed_domains_csv or "").split(",") if d.strip()]
    container.db.set_api_key_domain_scope(key_id=key_id, all_domains=allow_all, domains=domains)
    _write_auto_backup(container, "update_key_access")
    return RedirectResponse(url="/admin/", status_code=303)


@router.post("/keys/rate-limit/update")
async def update_key_rate_limit(
    request: Request,
    key_id: int = Form(...),
    requests_per_minute: int = Form(...),
    burst: int = Form(0),
):
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    if requests_per_minute <= 0:
        raise HTTPException(status_code=400, detail="requests_per_minute must be > 0")
    container.db.set_api_key_rate_limit(
        key_id=key_id,
        requests_per_minute=requests_per_minute,
        burst=burst,
    )
    _write_auto_backup(container, "update_key_rate_limit")
    return RedirectResponse(url="/admin/", status_code=303)


@router.post("/keys/revoke")
async def revoke_key(request: Request, key_id: int = Form(...)):
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    container.key_service.revoke_key_by_id(key_id)
    _write_auto_backup(container, "revoke_key")
    return RedirectResponse(url="/admin/", status_code=303)


@router.post("/keys/delete")
async def delete_revoked_key(request: Request, key_id: int = Form(...)):
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    deleted = container.key_service.delete_revoked_key_by_id(key_id)
    if deleted:
        _write_auto_backup(container, "delete_revoked_key")
    if _wants_json(request):
        if deleted:
            return JSONResponse(status_code=200, content={"ok": True})
        return JSONResponse(status_code=400, content={"ok": False, "message": "Only revoked keys can be deleted"})
    return RedirectResponse(url="/admin/", status_code=303)


@router.post("/mappings/proposals/reject")
async def reject_field_mapping_proposal(request: Request, proposal_id: int = Form(...)):
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    container.db.mark_field_mapping_proposal_status(proposal_id, "rejected")
    return RedirectResponse(url="/admin/", status_code=303)


@router.post("/mappings/proposals/approve")
async def approve_field_mapping_proposal(
    request: Request,
    proposal_id: int = Form(...),
    ai_model_id: int = Form(...),
):
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    proposal = next(
        (row for row in container.db.get_pending_field_mapping_proposals() if int(row["id"]) == proposal_id),
        None,
    )
    if not proposal:
        raise HTTPException(status_code=404, detail="proposal not found")
    container.db.set_field_mapping(
        domain=proposal["domain"],
        field_name=_default_field_for_task(proposal["task_type"]),
        task_type=proposal["task_type"],
        source_data_type=proposal["source_data_type"],
        source_selector=proposal["source_selector"],
        target_data_type=proposal["target_data_type"],
        target_selector=proposal["target_selector"],
        ai_model_id=ai_model_id,
    )
    container.db.mark_field_mapping_proposal_status(proposal_id, "approved")
    return RedirectResponse(url="/admin/", status_code=303)


@router.post("/locators/approve")
async def approve_locator(request: Request, locator_id: int = Form(...)):
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    container.db.approve_locator(locator_id)
    return RedirectResponse(url="/admin/", status_code=303)


@router.post("/locators/reject")
async def reject_locator(request: Request, locator_id: int = Form(...)):
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    container.db.reject_locator(locator_id)
    return RedirectResponse(url="/admin/", status_code=303)


# ═══════════════════════════════════════════════════════════════════════════════
# WhatsApp Alert Admin Endpoints
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/api/alerts/config")
async def get_alert_config(request: Request):
    """Return current WhatsApp alert config status (no secrets exposed)."""
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    svc = container.alert_service
    return {
        "enabled":       svc._enabled,
        "phone_set":     bool(svc._phone),
        "apikey_set":    bool(svc._apikey),
        "phone_preview": (svc._phone[:4] + "****" + svc._phone[-3:]) if len(svc._phone) > 7 else "not set",
    }


@router.post("/api/alerts/test")
async def test_alert(request: Request):
    """Send a test WhatsApp message to verify configuration."""
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    ok = container.alert_service.send("🧪 *Test Alert*\nUnified Platform WhatsApp alerts are working correctly!")
    return {"ok": ok, "message": "Test message sent" if ok else "Failed — check CALLMEBOT_PHONE and CALLMEBOT_APIKEY in .env"}


@router.post("/api/alerts/notify-key")
async def notify_key_alert(request: Request, key_name: str = Form(...), expires_at: str = Form("")):
    """Manually trigger a new-key WhatsApp notification (e.g. after sharing key with user)."""
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    container.alert_service.notify_new_key(key_name=key_name, expires_at=expires_at or None)
    return {"ok": True}

