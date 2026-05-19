"""Auth, usage, and key-management endpoints."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request

from app.core.database import Database
from app.models.schemas import KeyCreateRequest, KeyCreateResponse, KeyRevokeRequest, VerifyResponse

from .utils import ensure_master_key

router = APIRouter(tags=["v1"])


@router.get("/auth/verify", response_model=VerifyResponse)
async def verify(request: Request) -> VerifyResponse:
    key_record = request.state.api_key_record
    container = request.app.state.container
    key_hash = key_record.get("key_hash", "")
    is_master = container.db.is_master_key_hash(key_hash)
    entitlements = container.db.get_api_key_entitlements(int(key_record["id"]))
    return VerifyResponse(
        valid=True,
        key_name=str(key_record["name"]),
        expires_at=key_record["expires_at"],
        is_master=is_master,
        plan_name=str(entitlements.get("plan_name") or "Standard"),
        mobile=str(entitlements.get("mobile") or ""),
        telegram_id=str(entitlements.get("telegram_id") or ""),
        enabled_services=entitlements.get("services") or {},
        rate_limit=container.db.get_api_key_rate_limit(int(key_record["id"])),
    )


@router.get("/usage")
async def usage(request: Request) -> dict:
    container = request.app.state.container
    key_record = request.state.api_key_record
    summary = container.db.get_usage_summary(key_id=int(key_record["id"]))
    return {"key_name": key_record["name"], "usage": summary}


@router.post("/key/create", response_model=KeyCreateResponse)
async def create_key(request: Request, payload: KeyCreateRequest) -> KeyCreateResponse:
    ensure_master_key(request)
    container = request.app.state.container
    _key_id, plain, expires_at = container.key_service.create_key(
        name=payload.name,
        expiry_days=payload.expiry_days,
    )
    return KeyCreateResponse(api_key=plain, expires_at=expires_at)


@router.post("/key/revoke")
async def revoke_key(request: Request, payload: KeyRevokeRequest) -> dict:
    ensure_master_key(request)
    container = request.app.state.container
    if not container.key_service.revoke_key(payload.api_key):
        raise HTTPException(404, "key not found")
    return {"revoked": True}
