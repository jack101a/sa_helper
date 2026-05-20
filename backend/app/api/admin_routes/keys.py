from __future__ import annotations
import logging
from fastapi import APIRouter, Request, Form, HTTPException
from fastapi.responses import RedirectResponse, JSONResponse, HTMLResponse
from fastapi.templating import Jinja2Templates
from pathlib import Path
from .utils import _admin_guard, _write_auto_backup

router = APIRouter(tags=["admin-keys"])
logger = logging.getLogger(__name__)

# Use absolute path for templates
_TEMPLATE_DIR = Path(__file__).resolve().parents[2] / "templates"
templates = Jinja2Templates(directory=str(_TEMPLATE_DIR))

@router.post("/api/keys/create")
async def api_create_key(
    request: Request,
    key_name: str = Form(...),
    expiry_days: int = Form(30),
    all_domains: str = Form("on"),
    allowed_domains_csv: str = Form(""),
    requests_per_minute: int = Form(0),
    burst: int = Form(0),
    key_type: str = Form("user"),
    plan_name: str = Form("Standard"),
    mobile: str = Form(""),
    telegram_id: str = Form(""),
    service_autofill: str = Form("on"),
    service_captcha: str = Form("on"),
    service_stall: str = Form("on"),
    service_solver: str = Form("on"),
    service_custom: str = Form(""),
):
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    warnings: list[str] = []
    key_id, plain, expires = container.key_service.create_key(name=key_name, expiry_days=expiry_days, key_type=key_type)
    allow_all = str(all_domains).lower() in {"1", "true", "on", "yes"}
    domains = [d.strip() for d in str(allowed_domains_csv or "").split(",") if d.strip()]
    try:
        container.db.set_api_key_domain_scope(key_id=key_id, all_domains=allow_all, domains=domains)
        if int(requests_per_minute or 0) > 0:
            container.db.set_api_key_rate_limit(
                key_id=key_id,
                requests_per_minute=int(requests_per_minute),
                burst=int(burst or 0),
            )
        container.db.set_api_key_entitlements(
            key_id=key_id,
            plan_name=plan_name,
            mobile=mobile,
            telegram_id=telegram_id,
            services={
                "autofill": str(service_autofill).lower() in {"1", "true", "on", "yes"},
                "captcha": str(service_captcha).lower() in {"1", "true", "on", "yes"},
                "stall": str(service_stall).lower() in {"1", "true", "on", "yes"},
                "solver": str(service_solver).lower() in {"1", "true", "on", "yes"},
                "custom": str(service_custom).lower() in {"1", "true", "on", "yes"},
            },
        )
    except Exception as e:
        try:
            container.key_service.revoke_key_by_id(key_id)
        except Exception:
            logger.exception("api_key_create_revoke_after_config_failure_failed", extra={"context": {"key_id": key_id}})
        logger.exception("api_key_create_config_failed", extra={"context": {"key_id": key_id, "error": str(e)}})
        raise HTTPException(status_code=500, detail="Key was created but configuration failed; the key was revoked. Please create it again.") from e

    try:
        _write_auto_backup(container, "api_create_key")
    except Exception as e:
        logger.exception("api_key_create_backup_failed", extra={"context": {"key_id": key_id, "error": str(e)}})
        warnings.append("Auto-backup failed after key creation.")

    try:
        container.alert_service.notify_new_key(key_name=key_name, expires_at=expires)
    except Exception as e:
        logger.exception("api_key_create_alert_failed", extra={"context": {"key_id": key_id, "error": str(e)}})
        warnings.append("WhatsApp notification failed after key creation.")

    return JSONResponse(
        status_code=201,
        content={"ok": True, "key_id": key_id, "api_key": plain, "expires_at": expires, "warnings": warnings},
    )

@router.post("/keys/entitlements/update")
async def update_key_entitlements(
    request: Request,
    key_id: int = Form(...),
    plan_name: str = Form("Standard"),
    mobile: str = Form(""),
    telegram_id: str = Form(""),
    service_autofill: str = Form(""),
    service_captcha: str = Form(""),
    service_stall: str = Form(""),
    service_solver: str = Form(""),
    service_custom: str = Form(""),
):
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    container.db.set_api_key_entitlements(
        key_id=key_id,
        plan_name=plan_name,
        mobile=mobile,
        telegram_id=telegram_id,
        services={
            "autofill": str(service_autofill).lower() in {"1", "true", "on", "yes"},
            "captcha": str(service_captcha).lower() in {"1", "true", "on", "yes"},
            "stall": str(service_stall).lower() in {"1", "true", "on", "yes"},
            "solver": str(service_solver).lower() in {"1", "true", "on", "yes"},
            "custom": str(service_custom).lower() in {"1", "true", "on", "yes"},
        },
    )
    _write_auto_backup(container, "update_key_entitlements")
    return JSONResponse({"ok": True})

@router.post("/keys/create")
async def create_key(request: Request, key_name: str = Form(...), expiry_days: int = Form(30), key_type: str = Form("user")):
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    _key_id, plain, expires = container.key_service.create_key(name=key_name, expiry_days=expiry_days, key_type=key_type)
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
    from .utils import _wants_json
    deleted = container.key_service.delete_revoked_key_by_id(key_id)
    if deleted:
        _write_auto_backup(container, "delete_revoked_key")
    if _wants_json(request):
        if deleted:
            return JSONResponse(status_code=200, content={"ok": True})
        return JSONResponse(status_code=400, content={"ok": False, "message": "Only revoked keys can be deleted"})
    return RedirectResponse(url="/admin/", status_code=303)
