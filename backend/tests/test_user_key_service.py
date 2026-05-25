from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.db import Base
from app.core.models import SubscriptionPlan, User, UserApiKey, UserSubscription
from app.core.security import hash_api_key
from app.services.user_key_service import UserKeyService


def _session_factory():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)


def _settings():
    settings = MagicMock()
    settings.auth.hash_salt = "test-salt"
    settings.auth.key_prefix = "SK-"
    settings.auth.key_length = 16
    settings.auth.default_expiry_days = 30
    return settings


def _seed_user_with_plan(Session, *, user_status="active", subscription_status="active", end_delta_days=10):
    session = Session()
    now = datetime.now(timezone.utc)
    try:
        user = User(full_name="Test User", status=user_status)
        plan = SubscriptionPlan(
            code="standard",
            name="Standard",
            monthly_limit=100,
            duration_days=30,
            price_amount=1000,
        )
        session.add_all([user, plan])
        session.flush()
        sub = UserSubscription(
            user_id=user.id,
            plan_id=plan.id,
            status=subscription_status,
            monthly_limit_snapshot=plan.monthly_limit,
            start_at=now - timedelta(days=1),
            end_at=now + timedelta(days=end_delta_days),
            current_cycle_start_at=now - timedelta(days=1),
            current_cycle_end_at=now + timedelta(days=29),
        )
        session.add(sub)
        session.commit()
        return user.id
    finally:
        session.close()


def test_create_user_key_has_no_independent_expiry():
    Session = _session_factory()
    user_id = _seed_user_with_plan(Session)
    svc = UserKeyService(Session, _settings())

    key, plain = svc.create_key(user_id)

    assert plain.startswith("SK-")
    assert key.status == "active"
    assert key.expires_at is None


def test_validate_user_key_requires_active_subscription():
    Session = _session_factory()
    user_id = _seed_user_with_plan(Session, end_delta_days=-1)
    settings = _settings()
    plain = "SK-expired-subscription"
    session = Session()
    try:
        session.add(UserApiKey(
            user_id=user_id,
            key_hash=hash_api_key(plain, settings.auth.hash_salt),
            key_prefix_display=plain[:10] + "...",
            status="active",
        ))
        session.commit()
    finally:
        session.close()

    result = UserKeyService(Session, settings).validate_key(plain)

    assert result["auth_error"] == "expired_subscription"


def test_validate_user_key_distinguishes_revoked_key():
    Session = _session_factory()
    user_id = _seed_user_with_plan(Session)
    settings = _settings()
    plain = "SK-revoked"
    session = Session()
    try:
        session.add(UserApiKey(
            user_id=user_id,
            key_hash=hash_api_key(plain, settings.auth.hash_salt),
            key_prefix_display=plain[:10] + "...",
            status="revoked",
            revoked_at=datetime.now(timezone.utc),
            revoked_reason="admin_revoked",
        ))
        session.commit()
    finally:
        session.close()

    result = UserKeyService(Session, settings).validate_key(plain)

    assert result["auth_error"] == "revoked_key"
