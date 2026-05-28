import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from app.api.v1_routes.captcha import solve
from app.models.schemas import SolveRequest


def _request(*, is_user_key=True, quota_allowed=True):
    usage_cycle_service = MagicMock()
    usage_cycle_service.check_quota.return_value = {
        "allowed": quota_allowed,
        "used": 0 if quota_allowed else 6000,
        "limit": 6000,
    }
    usage_cycle_service.increment_usage_atomic.return_value = {
        "allowed": quota_allowed,
        "used": 1 if quota_allowed else 6000,
        "limit": 6000,
    }
    container = SimpleNamespace(
        db=MagicMock(
            get_global_access=MagicMock(return_value=True),
            is_domain_allowed=MagicMock(return_value=True),
            is_domain_allowed_for_key=MagicMock(return_value=True),
        ),
        solver_service=MagicMock(
            submit=AsyncMock(return_value={"result": "ABCD", "processing_ms": 12, "cached": False, "model_used": "onnx"})
        ),
        usage_service=MagicMock(),
        usage_cycle_service=usage_cycle_service,
    )
    return SimpleNamespace(
        app=SimpleNamespace(state=SimpleNamespace(container=container)),
        state=SimpleNamespace(
            api_key_record={"id": 10, "key_type": "user", "user_id": 99},
            is_user_key=is_user_key,
        ),
        client=SimpleNamespace(host="127.0.0.1"),
        headers={},
    )


def _payload():
    return SolveRequest(type="image", payload_base64="QUJDRA==", mode="fast", domain="example.com")


def test_user_captcha_solve_increments_subscription_usage():
    request = _request(is_user_key=True, quota_allowed=True)

    with patch("app.api.v1_routes.captcha.ensure_service_allowed"):
        response = asyncio.run(solve(request, _payload()))

    assert response.result == "ABCD"
    request.app.state.container.usage_cycle_service.check_quota.assert_called_once_with(99)
    request.app.state.container.usage_cycle_service.increment_usage_atomic.assert_called_once_with(99, amount=1)


def test_legacy_captcha_solve_does_not_touch_subscription_usage():
    request = _request(is_user_key=False, quota_allowed=True)

    with patch("app.api.v1_routes.captcha.ensure_service_allowed"):
        response = asyncio.run(solve(request, _payload()))

    assert response.result == "ABCD"
    request.app.state.container.usage_cycle_service.check_quota.assert_not_called()
    request.app.state.container.usage_cycle_service.increment_usage_atomic.assert_not_called()


def test_user_captcha_solve_rejects_before_solver_when_quota_exceeded():
    request = _request(is_user_key=True, quota_allowed=False)

    with pytest.raises(HTTPException) as exc:
        with patch("app.api.v1_routes.captcha.ensure_service_allowed"):
            asyncio.run(solve(request, _payload()))

    assert exc.value.status_code == 429
    request.app.state.container.solver_service.submit.assert_not_called()
    request.app.state.container.usage_cycle_service.increment_usage_atomic.assert_not_called()
