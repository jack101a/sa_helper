"""API key and admin token middleware — supports legacy + user-linked keys."""

from __future__ import annotations

import logging

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.config import Settings
from app.services.key_service import KeyService

logger = logging.getLogger(__name__)

# Paths exempt from API-key authentication
_PUBLIC_V1_PATHS = {
    "/v1/locators",
    "/v1/field-mappings/routes",
}

# Explicit error codes for client UX
ERROR_CODES = {
    "invalid_key":        ("api key invalid", 401),
    "revoked_key":        ("api key revoked", 401),
    "expired_key":        ("api key expired", 401),
    "blocked_user":       ("account blocked — contact support", 403),
    "inactive_user":      ("account inactive — subscription required", 403),
    "expired_subscription": ("subscription expired — renew required", 403),
    "device_mismatch":    ("api key locked to another device", 401),
    "quota_exceeded":     ("monthly quota exceeded", 429),
    "payment_pending":    ("payment pending — complete registration", 403),
}


class AuthMiddleware(BaseHTTPMiddleware):
    """Validate API keys for v1 routes — legacy + user-linked keys."""

    def __init__(self, app, settings: Settings, key_service: KeyService) -> None:
        super().__init__(app)
        self._settings = settings
        self._key_service = key_service

    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        if not path.startswith("/v1") or path in _PUBLIC_V1_PATHS:
            return await call_next(request)

        # Admin-token-protected key management endpoints
        if path in {"/v1/key/create", "/v1/key/revoke"}:
            import hmac
            token = request.headers.get("x-admin-token", "")
            if not hmac.compare_digest(token, self._settings.auth.admin_token):
                return self._error("invalid_key", request, path, reason="invalid_admin_token")
            return await call_next(request)

        api_key = request.headers.get("x-api-key", "")
        device_id = self._get_device_id(request)

        # ── Try user-linked key first (new scalable system) ───────────────
        user_result = await self._try_user_key(request, api_key, device_id, path, call_next)
        if user_result is not None:
            return user_result  # None means "try legacy", otherwise a response

        # ── Fall back to legacy key validation ─────────────────────────────
        record = self._key_service.validate_key(api_key)
        if not record:
            return self._error("invalid_key", request, path, api_key_present=bool(api_key))

        if not self._key_service.validate_or_bind_device(
            key_id=int(record["id"]),
            device_id=device_id,
            user_agent=request.headers.get("user-agent", ""),
        ):
            return self._error("device_mismatch", request, path, key_id=record.get("id"))

        request.state.api_key_record = record
        request.state.api_key = api_key
        request.state.device_id = device_id
        return await call_next(request)

    async def _try_user_key(self, request: Request, api_key: str, device_id: str, path: str, call_next):
        """Try user-linked key validation. Returns None to fall through to legacy."""
        try:
            from app.services.user_key_service import UserKeyService
            from app.core.db import get_session

            # Access user_key_service from app state
            user_key_svc = getattr(request.app.state, "user_key_service", None)
            if user_key_svc is None:
                return None  # Not initialized yet — fall through

            record = user_key_svc.validate_key(api_key)
            if not record:
                return None  # Not a user-linked key — fall through to legacy

            auth_error = record.get("auth_error")
            if auth_error:
                return self._error(auth_error, request, path, key_id=record.get("id"))

            # Check user status for explicit error codes
            user_status = record.get("user_status", "unknown")
            if user_status == "blocked":
                return self._error("blocked_user", request, path)
            if user_status == "inactive":
                return self._error("inactive_user", request, path)
            if user_status == "pending_payment":
                return self._error("payment_pending", request, path)

            # Validate device binding
            if not user_key_svc.validate_device(record["id"], device_id):
                # Try to bind if no device yet
                bound = user_key_svc.bind_device(record["id"], device_id)
                if bound is None:
                    return self._error("device_mismatch", request, path, key_id=record["id"])

            request.state.api_key_record = record
            request.state.api_key = api_key
            request.state.device_id = device_id
            request.state.is_user_key = True
            logger.info("user_key_valid", extra={"context": {"path": path, "user_id": record.get("user_id")}})
            return await call_next(request)
        except Exception as e:
            logger.error(
                "user_key_check_failed_fallthrough",
                extra={"context": {
                    "error": str(e),
                    "error_type": type(e).__name__,
                    "path": path,
                    "api_key_present": bool(api_key),
                }},
            )
            return None  # Fall through to legacy on error

    def _get_device_id(self, request: Request) -> str:
        device_id = (
            request.headers.get("x-device-id", "").strip()
            or request.headers.get("x-client-device-id", "").strip()
        )
        if not device_id:
            ua = request.headers.get("user-agent", "").strip()
            device_id = f"ua:{ua[:180]}" if ua else "ua:unknown"
        return device_id

    def _error(self, code: str, request: Request, path: str, **extra) -> JSONResponse:
        detail, status = ERROR_CODES.get(code, ("unauthorized", 401))
        logger.warning(
            f"auth_{code}",
            extra={"context": {"path": path, "code": code, **extra}},
        )
        return JSONResponse({"detail": detail, "error_code": code}, status_code=status)
