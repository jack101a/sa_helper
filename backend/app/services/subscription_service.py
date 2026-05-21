"""Subscription management service — plans, user subscriptions, lifecycle."""

from __future__ import annotations

from datetime import datetime, timezone, timedelta
from typing import Optional

from sqlalchemy.orm import Session
from sqlalchemy import or_

from app.core.models import SubscriptionPlan, UserSubscription, User


class SubscriptionService:
    """Manages subscription plans and user subscription lifecycle."""

    def __init__(self, session_factory):
        self._session_factory = session_factory

    def _session(self) -> Session:
        return self._session_factory()

    # ── Plans ──────────────────────────────────────────────────────────────

    def create_plan(
        self,
        code: str,
        name: str,
        monthly_limit: int = 3000,
        duration_days: int = 30,
        price_amount: int = 0,
        currency: str = "INR",
        description: str = "",
        max_devices: int = 1,
        allowed_services: dict | None = None,
        rate_limit_rpm: int = 60,
        rate_limit_burst: int = 10,
    ) -> SubscriptionPlan:
        session = self._session()
        try:
            plan = SubscriptionPlan(
                code=code,
                name=name,
                description=description,
                monthly_limit=monthly_limit,
                duration_days=duration_days,
                price_amount=price_amount,
                currency=currency,
                max_devices=max_devices,
                allowed_services=allowed_services or {},
                rate_limit_rpm=rate_limit_rpm,
                rate_limit_burst=rate_limit_burst,
            )
            session.add(plan)
            session.commit()
            session.refresh(plan)
            return plan
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    def get_plan(self, plan_id: int) -> SubscriptionPlan | None:
        session = self._session()
        try:
            return session.query(SubscriptionPlan).filter(SubscriptionPlan.id == plan_id).first()
        finally:
            session.close()

    def get_plan_by_code(self, code: str) -> SubscriptionPlan | None:
        session = self._session()
        try:
            return session.query(SubscriptionPlan).filter(SubscriptionPlan.code == code).first()
        finally:
            session.close()

    def list_plans(self, active_only: bool = True) -> list[SubscriptionPlan]:
        session = self._session()
        try:
            q = session.query(SubscriptionPlan)
            if active_only:
                q = q.filter(SubscriptionPlan.is_active == True)
            return q.order_by(SubscriptionPlan.price_amount).all()
        finally:
            session.close()

    def update_plan(self, plan_id: int, **kwargs) -> SubscriptionPlan | None:
        session = self._session()
        try:
            plan = session.query(SubscriptionPlan).filter(SubscriptionPlan.id == plan_id).first()
            if not plan:
                return None
            for key, value in kwargs.items():
                if hasattr(plan, key):
                    setattr(plan, key, value)
            plan.updated_at = datetime.now(timezone.utc)
            session.commit()
            session.refresh(plan)
            return plan
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    def delete_plan(self, plan_id: int, target_plan_id: int | None = None) -> dict | None:
        """Deactivate a plan and optionally migrate linked subscriptions to another plan."""
        session = self._session()
        try:
            plan = session.query(SubscriptionPlan).filter(SubscriptionPlan.id == plan_id).first()
            if not plan:
                return None
            target_plan = None
            if target_plan_id is not None:
                if int(target_plan_id) == int(plan_id):
                    raise ValueError("target_plan_id must be different from plan_id")
                target_plan = (
                    session.query(SubscriptionPlan)
                    .filter(SubscriptionPlan.id == int(target_plan_id))
                    .first()
                )
                if not target_plan:
                    raise ValueError(f"Target plan {target_plan_id} not found")
                if not target_plan.is_active:
                    raise ValueError("Target plan must be active")

            migrated_count = 0
            if target_plan is not None:
                subs = (
                    session.query(UserSubscription)
                    .filter(
                        UserSubscription.plan_id == plan_id,
                        or_(
                            UserSubscription.status == "active",
                            UserSubscription.status == "pending",
                        ),
                    )
                    .all()
                )
                for sub in subs:
                    sub.plan_id = int(target_plan.id)
                    sub.monthly_limit_snapshot = int(target_plan.monthly_limit)
                    sub.updated_at = datetime.now(timezone.utc)
                migrated_count = len(subs)

            plan.is_active = False
            plan.updated_at = datetime.now(timezone.utc)
            session.commit()
            session.refresh(plan)
            return {
                "plan": plan,
                "migrated_count": migrated_count,
                "target_plan_id": int(target_plan.id) if target_plan is not None else None,
            }
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    # ── User Subscriptions ─────────────────────────────────────────────────

    def create_subscription(
        self,
        user_id: int,
        plan_id: int,
        approved_by_admin_id: int | None = None,
    ) -> UserSubscription:
        session = self._session()
        try:
            plan = session.query(SubscriptionPlan).filter(SubscriptionPlan.id == plan_id).first()
            if not plan:
                raise ValueError(f"Plan {plan_id} not found")

            now = datetime.now(timezone.utc)
            sub = UserSubscription(
                user_id=user_id,
                plan_id=plan_id,
                status="active",
                monthly_limit_snapshot=plan.monthly_limit,
                start_at=now,
                end_at=now + timedelta(days=plan.duration_days),
                billing_anchor_day=now.day,
                current_cycle_start_at=now,
                current_cycle_end_at=now + timedelta(days=30),
                approved_by_admin_id=approved_by_admin_id,
                approved_at=now,
            )
            session.add(sub)

            # Activate the user (unless blocked)
            user = session.query(User).filter(User.id == user_id).first()
            if user:
                if user.status != "blocked":
                    user.status = "active"
                user.updated_at = now

            session.commit()
            session.refresh(sub)
            return sub
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    def get_active_subscription(self, user_id: int) -> UserSubscription | None:
        session = self._session()
        try:
            return (
                session.query(UserSubscription)
                .filter(
                    UserSubscription.user_id == user_id,
                    UserSubscription.status == "active",
                )
                .order_by(UserSubscription.created_at.desc())
                .first()
            )
        finally:
            session.close()

    def get_user_subscriptions(self, user_id: int) -> list[UserSubscription]:
        session = self._session()
        try:
            return (
                session.query(UserSubscription)
                .filter(UserSubscription.user_id == user_id)
                .order_by(UserSubscription.created_at.desc())
                .all()
            )
        finally:
            session.close()

    def cancel_subscription(self, subscription_id: int) -> UserSubscription | None:
        session = self._session()
        try:
            sub = session.query(UserSubscription).filter(UserSubscription.id == subscription_id).first()
            if not sub:
                return None
            sub.status = "cancelled"
            sub.updated_at = datetime.now(timezone.utc)
            session.commit()
            session.refresh(sub)
            return sub
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    def expire_subscription(self, subscription_id: int) -> UserSubscription | None:
        session = self._session()
        try:
            sub = session.query(UserSubscription).filter(UserSubscription.id == subscription_id).first()
            if not sub:
                return None
            sub.status = "expired"
            sub.updated_at = datetime.now(timezone.utc)

            # Also expire the user
            user = session.query(User).filter(User.id == sub.user_id).first()
            if user:
                user.status = "expired"
                user.updated_at = datetime.now(timezone.utc)

            session.commit()
            session.refresh(sub)
            return sub
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    def expire_overdue(self) -> list[dict]:
        """Find and expire all active subscriptions past end_at. Returns list of expired user info."""
        session = self._session()
        try:
            now = datetime.now(timezone.utc)
            overdue = (
                session.query(UserSubscription)
                .filter(
                    UserSubscription.status == "active",
                    UserSubscription.end_at < now,
                )
                .all()
            )
            expired_users = []
            for sub in overdue:
                sub.status = "expired"
                sub.updated_at = now
                user = session.query(User).filter(User.id == sub.user_id).first()
                if user:
                    user.status = "expired"
                    user.updated_at = now
                    expired_users.append({
                        "user_id": user.id,
                        "name": user.full_name,
                        "telegram_chat_id": user.telegram_chat_id,
                        "telegram_user_id": user.telegram_user_id,
                    })
            session.commit()
            return expired_users
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()
