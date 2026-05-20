"""Admin API — User management (CRUD, status, search)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Request, Query
from fastapi.responses import JSONResponse

from app.core.models import UserSubscription, SubscriptionPlan, UsageCycle
from app.core.db import get_session

from .utils import _admin_guard

router = APIRouter(tags=["admin-users"])


@router.get("/api/users")
async def list_users(
    request: Request,
    status: str | None = Query(None),
    search: str | None = Query(None),
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
) -> Any:
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    users, total = container.user_service.list_users(
        status=status, search=search, offset=offset, limit=limit
    )
    # Enrich with subscription info
    session = get_session()
    try:
        user_dicts = []
        for u in users:
            d = u.to_dict()
            sub = session.query(UserSubscription).filter(
                UserSubscription.user_id == u.id,
                UserSubscription.status == "active",
            ).first()
            if sub:
                plan = session.query(SubscriptionPlan).filter(SubscriptionPlan.id == sub.plan_id).first()
                cycle = session.query(UsageCycle).filter(
                    UsageCycle.user_id == u.id,
                ).order_by(UsageCycle.cycle_start_at.desc()).first()
                d["plan_name"] = plan.name if plan else None
                d["plan_monthly_limit"] = plan.monthly_limit if plan else None
                d["subscription_expiry"] = sub.end_at.isoformat() if sub.end_at else None
                d["usage_used"] = cycle.used_count if cycle else 0
            else:
                d["plan_name"] = None
                d["plan_monthly_limit"] = None
                d["subscription_expiry"] = None
                d["usage_used"] = 0
            user_dicts.append(d)
    finally:
        session.close()

    return JSONResponse({
        "users": user_dicts,
        "total": total,
        "offset": offset,
        "limit": limit,
    })


@router.get("/api/users/{user_id}")
async def get_user(request: Request, user_id: int) -> Any:
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    user = container.user_service.get_user(user_id)
    if not user:
        return JSONResponse({"error": "User not found"}, status_code=404)
    return JSONResponse(user.to_dict())


@router.post("/api/users")
async def create_user(request: Request) -> Any:
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    body = await request.json()
    try:
        user = container.user_service.create_user(
            full_name=body.get("full_name", ""),
            mobile_number=body.get("mobile_number"),
            telegram_user_id=body.get("telegram_user_id"),
            telegram_chat_id=body.get("telegram_chat_id"),
            notes=body.get("notes", ""),
        )
        container.audit_service.log(
            actor_type="admin", action="user_created",
            target_type="user", target_id=user.id,
        )
        return JSONResponse(user.to_dict(), status_code=201)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=400)


@router.put("/api/users/{user_id}")
async def update_user(request: Request, user_id: int) -> Any:
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    body = await request.json()
    user = container.user_service.update_user(
        user_id=user_id,
        full_name=body.get("full_name"),
        mobile_number=body.get("mobile_number"),
        notes=body.get("notes"),
    )
    if not user:
        return JSONResponse({"error": "User not found"}, status_code=404)
    container.audit_service.log(
        actor_type="admin", action="user_updated",
        target_type="user", target_id=user.id,
    )
    return JSONResponse(user.to_dict())


@router.post("/api/users/{user_id}/status")
async def set_user_status(request: Request, user_id: int) -> Any:
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    body = await request.json()
    new_status = body.get("status", "")
    valid_statuses = ["active", "blocked", "inactive", "expired", "deleted", "pending_payment", "pending_approval"]
    if new_status not in valid_statuses:
        return JSONResponse({"error": f"Invalid status. Must be one of: {valid_statuses}"}, status_code=400)

    user = container.user_service.set_user_status(user_id, new_status)
    if not user:
        return JSONResponse({"error": "User not found"}, status_code=404)
    container.audit_service.log(
        actor_type="admin", action=f"user_{new_status}",
        target_type="user", target_id=user.id,
    )
    return JSONResponse(user.to_dict())


@router.delete("/api/users/{user_id}")
async def delete_user(request: Request, user_id: int) -> Any:
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    ok = container.user_service.delete_user(user_id)
    if not ok:
        return JSONResponse({"error": "User not found"}, status_code=404)
    container.audit_service.log(
        actor_type="admin", action="user_deleted",
        target_type="user", target_id=user_id,
    )
    return JSONResponse({"ok": True})
