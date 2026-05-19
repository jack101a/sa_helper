from __future__ import annotations
import hmac
import logging
import os
from fastapi import APIRouter, Request, Form, Response
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from pathlib import Path
from .utils import _admin_session_cookie, _is_request_secure

logger = logging.getLogger(__name__)

router = APIRouter(tags=["admin-auth"])

# Use absolute path for templates
_TEMPLATE_DIR = Path(__file__).resolve().parents[2] / "templates"
templates = Jinja2Templates(directory=str(_TEMPLATE_DIR))

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

    logger.info("admin_login_attempt",
        extra={"context": {
            "has_user_pass": has_user_pass,
        }}
    )

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
        samesite="strict",
        secure=secure_cookie,
        domain=cookie_domain,
        path="/admin",
        max_age=60 * 60 * 12,
    )
    return response

@router.post("/logout")
async def admin_logout():
    """Clear admin session cookie."""
    response = RedirectResponse(url="/admin/login", status_code=303)
    response.delete_cookie("admin_session")
    return response
