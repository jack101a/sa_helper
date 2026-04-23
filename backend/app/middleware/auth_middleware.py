"""API key and admin token middleware."""

from __future__ import annotations

import logging

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.config import Settings
from app.services.key_service import KeyService

logger = logging.getLogger(__name__)


class AuthMiddleware(BaseHTTPMiddleware):
    """Validate API keys for v1 routes."""

    def __init__(self, app, settings: Settings, key_service: KeyService) -> None:
        super().__init__(app)
        self._settings = settings
        self._key_service = key_service

    async def dispatch(self, request: Request, call_next):
        """Apply auth rules by route."""

        path = request.url.path
        # Only apply auth to /v1 API routes
        if not path.startswith("/v1") or path == "/v1/locators":
            return await call_next(request)

        if path in {"/v1/key/create", "/v1/key/revoke"}:
            token = request.headers.get("x-admin-token", "")
            if token != self._settings.auth.admin_token:
                logger.warning(
                    "admin_auth_failed",
                    extra={"context": {"path": path, "reason": "invalid_admin_token"}},
                )
                return JSONResponse({"detail": "admin token invalid"}, status_code=401)
            logger.info("admin_auth_ok", extra={"context": {"path": path}})
            return await call_next(request)

        api_key = request.headers.get("x-api-key", "")
        record = self._key_service.validate_key(api_key)
        if not record:
            logger.warning(
                "api_key_invalid",
                extra={
                    "context": {
                        "path": path,
                        "api_key_present": bool(api_key),
                    }
                },
            )
            return JSONResponse({"detail": "api key invalid"}, status_code=401)
        logger.info(
            "api_key_valid",
            extra={"context": {"path": path, "key_id": record.get("id")}},
        )
        key_id = int(record["id"])
        device_id = (
            request.headers.get("x-device-id", "").strip()
            or request.headers.get("x-client-device-id", "").strip()
        )
        if not device_id:
            ua = request.headers.get("user-agent", "").strip()
            device_id = f"ua:{ua[:180]}" if ua else "ua:unknown"
        if not self._key_service.validate_or_bind_device(
            key_id=key_id,
            device_id=device_id,
            user_agent=request.headers.get("user-agent", ""),
        ):
            logger.warning(
                "api_key_device_mismatch",
                extra={"context": {"path": path, "key_id": key_id}},
            )
            return JSONResponse({"detail": "api key locked to another device"}, status_code=401)

        request.state.api_key_record = record
        request.state.api_key = api_key
        request.state.device_id = device_id
        return await call_next(request)
