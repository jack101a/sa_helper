"""Admin API — Subscription plans and user subscription management."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from .utils import _admin_guard

router = APIRouter(tags=["admin-subscriptions"])


# ── Plans ─────────────────────────────────────────────────────────────────

@router.get("/api/plans")
async def list_plans(request: Request) -> Any:
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    plans = container.subscription_service.list_plans(active_only=False)
    return JSONResponse({"plans": [p.to_dict() for p in plans]})


@router.post("/api/plans")
async def create_plan(request: Request) -> Any:
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    body = await request.json()
    try:
        plan = container.subscription_service.create_plan(
            code=body.get("code"),
            name=body["name"],
            monthly_limit=body.get("monthly_limit", 1000),
            duration_days=body.get("duration_days", 30),
            price_amount=body.get("price_amount", 0),
            currency=body.get("currency", "INR"),
            description=body.get("description", ""),
            max_devices=body.get("max_devices", 1),
            allowed_services=body.get("allowed_services", {}),
            rate_limit_rpm=body.get("rate_limit_rpm", 60),
        )
        container.audit_service.log(
            actor_type="admin", action="plan_created",
            target_type="plan", target_id=plan.id,
        )
        return JSONResponse(plan.to_dict(), status_code=201)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=400)


@router.put("/api/plans/{plan_id}")
async def update_plan(request: Request, plan_id: int) -> Any:
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    body = await request.json()
    plan = container.subscription_service.update_plan(plan_id, **body)
    if not plan:
        return JSONResponse({"error": "Plan not found"}, status_code=404)
    return JSONResponse(plan.to_dict())


# ── User Subscriptions ────────────────────────────────────────────────────

@router.post("/api/users/{user_id}/subscribe")
async def create_subscription(request: Request, user_id: int) -> Any:
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    body = await request.json()
    plan_id = body.get("plan_id")
    if not plan_id:
        return JSONResponse({"error": "plan_id is required"}, status_code=400)

    try:
        sub = container.subscription_service.create_subscription(
            user_id=user_id,
            plan_id=int(plan_id),
        )
        container.audit_service.log(
            actor_type="admin", action="subscription_activated",
            target_type="subscription", target_id=sub.id,
        )
        return JSONResponse(sub.to_dict(), status_code=201)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=400)


@router.get("/api/users/{user_id}/subscriptions")
async def get_user_subscriptions(request: Request, user_id: int) -> Any:
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    subs = container.subscription_service.get_user_subscriptions(user_id)
    return JSONResponse({"subscriptions": [s.to_dict() for s in subs]})


@router.post("/api/subscriptions/{subscription_id}/cancel")
async def cancel_subscription(request: Request, subscription_id: int) -> Any:
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    sub = container.subscription_service.cancel_subscription(subscription_id)
    if not sub:
        return JSONResponse({"error": "Subscription not found"}, status_code=404)
    container.audit_service.log(
        actor_type="admin", action="subscription_cancelled",
        target_type="subscription", target_id=subscription_id,
    )
    return JSONResponse(sub.to_dict())
