from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.db import Base
from app.core.models import SubscriptionPlan
from app.services.subscription_service import SubscriptionService
from app.services.telegram_bot import TelegramBotService


def _session_factory():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)


def test_subscription_service_can_create_private_bot_plan():
    Session = _session_factory()
    service = SubscriptionService(Session)

    plan = service.create_plan(
        code="admin_only",
        name="Admin Only",
        monthly_limit=5000,
        price_amount=99900,
        show_in_bot=False,
    )

    assert plan.show_in_bot is False


def test_inactive_plan_is_not_bot_visible():
    Session = _session_factory()
    service = SubscriptionService(Session)
    plan = service.create_plan(code="standard", name="Standard", show_in_bot=True)

    updated = service.update_plan(plan.id, is_active=False, show_in_bot=True)

    assert updated.is_active is False
    assert updated.show_in_bot is False


def test_telegram_bot_lists_only_active_visible_plans():
    Session = _session_factory()
    session = Session()
    try:
        session.add_all([
            SubscriptionPlan(code="public", name="Public", price_amount=1000, is_active=True, show_in_bot=True),
            SubscriptionPlan(code="private", name="Private", price_amount=2000, is_active=True, show_in_bot=False),
            SubscriptionPlan(code="inactive", name="Inactive", price_amount=3000, is_active=False, show_in_bot=True),
        ])
        session.commit()
    finally:
        session.close()

    bot = TelegramBotService(token="test-token", session_factory=Session)
    message = bot._get_plans_message()

    assert "Public" in message
    assert "Private" not in message
    assert "Inactive" not in message
