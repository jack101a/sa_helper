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
    client_ip = request.client.host if request.client else None
    try:
        container.usage_service.record(
            key_id=int(key_record["id"]),
            task_type="auth:verify",
            status="ok",
            processing_ms=0,
            model_used="auth",
            domain=Database._normalize_domain(request.headers.get("origin", "")) or None,
            ip=client_ip,
        )
    except Exception:
        pass
    key_hash = key_record.get("key_hash", "")
    is_user_key = bool(getattr(request.state, "is_user_key", False))
    is_master = False if is_user_key else container.db.is_master_key_hash(key_hash)
    entitlements = {} if is_user_key else container.db.get_api_key_entitlements(int(key_record["id"]))
    key_name = str(key_record.get("name") or "User Key")
    expires_at = key_record.get("expires_at")
    if is_user_key:
        from app.core.models import User, UserSubscription, SubscriptionPlan
        from app.core.db import get_session
        session = get_session()
        try:
            user = session.query(User).filter(User.id == int(key_record["user_id"])).first()
            sub = (
                session.query(UserSubscription)
                .filter(UserSubscription.user_id == int(key_record["user_id"]), UserSubscription.status == "active")
                .order_by(UserSubscription.created_at.desc())
                .first()
            )
            plan = session.query(SubscriptionPlan).filter(SubscriptionPlan.id == sub.plan_id).first() if sub else None
            services = (plan.allowed_services or {}) if plan else {}
            subscription_expires_at = sub.end_at.isoformat() if sub and sub.end_at else expires_at
            return VerifyResponse(
                valid=True,
                key_name=key_name,
                expires_at=subscription_expires_at,
                key_expires_at=expires_at,
                subscription_expires_at=subscription_expires_at,
                is_master=False,
                plan_name=plan.name if plan else "Standard",
                mobile=user.mobile_number if user and user.mobile_number else "",
                telegram_id=user.telegram_user_id if user and user.telegram_user_id else "",
                enabled_services=services,
                rate_limit={
                    "requests_per_minute": int(plan.rate_limit_rpm or 60),
                    "burst": int(getattr(plan, "rate_limit_burst", 10) or 10),
                } if plan else None,
            )
        finally:
            session.close()
    return VerifyResponse(
        valid=True,
        key_name=key_name,
        expires_at=expires_at,
        key_expires_at=expires_at,
        subscription_expires_at=None,
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
