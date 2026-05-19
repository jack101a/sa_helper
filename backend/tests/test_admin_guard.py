"""Tests for admin dashboard authentication guard."""

from unittest.mock import MagicMock

import pytest
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient


def _create_admin_app(settings):
    """Create app with a test admin endpoint using _admin_guard."""
    from app.api.admin_routes.utils import _admin_guard

    app = FastAPI()
    app.state.container = MagicMock()
    app.state.container.settings = settings

    @app.get("/admin/api/test")
    async def admin_test(request: Request):
        denied = _admin_guard(request)
        if denied:
            return denied
        return JSONResponse({"ok": True})

    return app


@pytest.fixture
def admin_settings():
    s = MagicMock()
    s.auth.admin_username = "admin"
    s.auth.admin_password = "password123"
    s.auth.hash_salt = "test-salt"
    s.auth.admin_token = "test-admin-token"
    return s


class TestAdminGuard:
    """Admin cookie authentication."""

    def test_no_cookie_returns_redirect(self, admin_settings):
        """Without auth cookie, admin routes should be denied."""
        app = _create_admin_app(admin_settings)
        client = TestClient(app)
        r = client.get("/admin/api/test", follow_redirects=False)
        assert r.status_code == 303

    def test_wrong_cookie_returns_redirect(self, admin_settings):
        app = _create_admin_app(admin_settings)
        client = TestClient(app)
        r = client.get("/admin/api/test", cookies={"admin_session": "wrong-token"}, follow_redirects=False)
        assert r.status_code == 303
