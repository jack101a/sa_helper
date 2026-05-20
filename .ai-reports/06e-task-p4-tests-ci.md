# Task P4 — Test Harness & CI Pipeline

> **Tasks**: T16, T17, T18, T19  
> **Priority**: P4 (safety net — should run before any major refactor)  
> **Depends on**: None  
> **Estimated changes**: ~300 lines new across 4 new files

---

## Files to Read First

1. `backend/tests/test_services.py` — existing test patterns (69 lines)
2. `backend/app/middleware/auth_middleware.py` — full file (137 lines)
3. `backend/app/services/key_service.py` — full file (61 lines)
4. `backend/app/services/user_key_service.py` — `validate_key()` + `bind_device()` methods
5. `backend/app/api/admin_routes/utils.py` — `_admin_guard()` function
6. `backend/app/core/security.py` — `hash_api_key()`, `generate_plain_api_key()`
7. `backend/requirements.txt` — check if `pytest` and `httpx` are listed

---

## T16: Create conftest.py with Shared Fixtures

### Goal

Create test fixtures that provide a mock database, mock settings, mock container, and test client.

**Create NEW file**: `backend/tests/conftest.py`

```python
"""Shared test fixtures for the sa-helper test suite."""

import os
import json
import tempfile
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

# Ensure test environment
os.environ.setdefault("AUTH_HASH_SALT", "test-salt-do-not-use-in-prod")
os.environ.setdefault("ADMIN_TOKEN", "test-admin-token")
os.environ.setdefault("APP_ENV", "test")


@pytest.fixture
def mock_settings():
    """Create a mock Settings object with test values."""
    settings = MagicMock()
    settings.auth.hash_salt = "test-salt-do-not-use-in-prod"
    settings.auth.admin_token = "test-admin-token"
    settings.auth.default_expiry_days = 30
    settings.auth.key_prefix = "SK-"
    settings.auth.key_length = 32
    settings.server.debug = True
    settings.storage.sqlite_path = ":memory:"
    return settings


@pytest.fixture
def tmp_data_dir():
    """Create a temporary data directory with minimal test data."""
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        
        # Create required subdirectories
        (tmp_path / "questions").mkdir(parents=True)
        (tmp_path / "hashes").mkdir(parents=True)
        (tmp_path / "models").mkdir(parents=True)
        
        # Minimal questions.json
        (tmp_path / "questions" / "questions.json").write_text(
            json.dumps([
                {
                    "question_text": "What is the speed limit in a residential area?",
                    "correct_option_number": 2,
                    "option_1": "60 km/h",
                    "option_2": "25 km/h",
                    "option_3": "80 km/h",
                    "option_4": "100 km/h",
                }
            ]),
            encoding="utf-8",
        )
        
        # Minimal sign hashes
        (tmp_path / "hashes" / "sign_hashes.json").write_text(
            json.dumps({"abc123": "STOP"}),
            encoding="utf-8",
        )
        (tmp_path / "hashes" / "sign_label.json").write_text(
            json.dumps({"STOP": "Stop Sign"}),
            encoding="utf-8",
        )
        (tmp_path / "hashes" / "sign_hashes_perceptual.json").write_text(
            json.dumps({}),
            encoding="utf-8",
        )
        
        yield tmp_path


@pytest.fixture
def mock_db():
    """Create a mock Database object."""
    db = MagicMock()
    # Mock exam_learned repo
    db.exam_learned.get_all_learned.return_value = []
    db.exam_learned.get_by_hash.return_value = None
    db.exam_learned.get_by_phash.return_value = None
    db.exam_learned.get_candidate_by_hash.return_value = None
    db.exam_learned.get_candidate_by_phash.return_value = None
    db.exam_learned.get_stats.return_value = {
        "total_learned": 0,
        "high_confidence": 0,
        "avg_confidence": 0.0,
        "total_confirmations": 0,
    }
    db.get_setting.return_value = ""
    db.get_api_key_by_hash.return_value = None
    return db


@pytest.fixture
def mock_key_service(mock_db, mock_settings):
    """Create a mock KeyService."""
    from app.services.key_service import KeyService
    return KeyService(db=mock_db, settings=mock_settings)
```

---

## T17: Create Auth Middleware Tests

### Goal

Test the dual-key authentication flow: valid key, invalid key, expired key, blocked user, device mismatch, and the user-key → legacy fallthrough.

**Create NEW file**: `backend/tests/test_auth_middleware.py`

```python
"""Tests for AuthMiddleware — dual-key authentication flow."""

import pytest
from unittest.mock import MagicMock, AsyncMock, patch
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from app.middleware.auth_middleware import AuthMiddleware


def _create_test_app(key_service, settings, user_key_svc=None):
    """Create a minimal FastAPI app with AuthMiddleware for testing."""
    app = FastAPI()
    app.add_middleware(AuthMiddleware, settings=settings, key_service=key_service)

    if user_key_svc:
        app.state.user_key_service = user_key_svc

    @app.get("/v1/test")
    async def test_endpoint(request: Request):
        record = getattr(request.state, "api_key_record", None)
        return {"ok": True, "key_id": record.get("id") if record else None}

    @app.get("/v1/locators")
    async def locators():
        return {"public": True}

    @app.get("/health")
    async def health():
        return {"status": "ok"}

    return app


@pytest.fixture
def settings():
    s = MagicMock()
    s.auth.hash_salt = "test-salt"
    s.auth.admin_token = "test-admin-token"
    s.auth.key_prefix = "SK-"
    return s


@pytest.fixture
def key_service():
    ks = MagicMock()
    ks.validate_key.return_value = None
    ks.validate_or_bind_device.return_value = True
    return ks


class TestPublicPaths:
    """Public paths should not require authentication."""

    def test_health_no_auth(self, settings, key_service):
        app = _create_test_app(key_service, settings)
        client = TestClient(app)
        r = client.get("/health")
        assert r.status_code == 200

    def test_locators_no_auth(self, settings, key_service):
        app = _create_test_app(key_service, settings)
        client = TestClient(app)
        r = client.get("/v1/locators")
        assert r.status_code == 200
        assert r.json()["public"] is True


class TestLegacyKey:
    """Legacy API key validation."""

    def test_valid_legacy_key(self, settings, key_service):
        key_service.validate_key.return_value = {"id": 1, "name": "test", "enabled": 1}
        app = _create_test_app(key_service, settings)
        client = TestClient(app)
        r = client.get("/v1/test", headers={"x-api-key": "valid-key"})
        assert r.status_code == 200
        assert r.json()["key_id"] == 1

    def test_invalid_key_returns_401(self, settings, key_service):
        key_service.validate_key.return_value = None
        app = _create_test_app(key_service, settings)
        client = TestClient(app)
        r = client.get("/v1/test", headers={"x-api-key": "bad-key"})
        assert r.status_code == 401
        assert r.json()["error_code"] == "invalid_key"

    def test_no_key_returns_401(self, settings, key_service):
        app = _create_test_app(key_service, settings)
        client = TestClient(app)
        r = client.get("/v1/test")
        assert r.status_code == 401

    def test_device_mismatch_returns_401(self, settings, key_service):
        key_service.validate_key.return_value = {"id": 1, "name": "test", "enabled": 1}
        key_service.validate_or_bind_device.return_value = False
        app = _create_test_app(key_service, settings)
        client = TestClient(app)
        r = client.get("/v1/test", headers={"x-api-key": "key", "x-device-id": "wrong-device"})
        assert r.status_code == 401
        assert r.json()["error_code"] == "device_mismatch"


class TestUserLinkedKey:
    """User-linked key validation with fallthrough to legacy."""

    def test_user_key_valid(self, settings, key_service):
        user_key_svc = MagicMock()
        user_key_svc.validate_key.return_value = {
            "id": 10, "user_id": 5, "key_hash": "h", "status": "active",
            "key_version": 1, "user_status": "active",
        }
        user_key_svc.validate_device.return_value = True
        app = _create_test_app(key_service, settings, user_key_svc=user_key_svc)
        client = TestClient(app)
        r = client.get("/v1/test", headers={"x-api-key": "user-key", "x-device-id": "dev1"})
        assert r.status_code == 200

    def test_user_key_blocked_returns_403(self, settings, key_service):
        user_key_svc = MagicMock()
        user_key_svc.validate_key.return_value = {
            "id": 10, "user_id": 5, "key_hash": "h", "status": "active",
            "key_version": 1, "user_status": "blocked",
        }
        app = _create_test_app(key_service, settings, user_key_svc=user_key_svc)
        client = TestClient(app)
        r = client.get("/v1/test", headers={"x-api-key": "user-key"})
        assert r.status_code == 403
        assert r.json()["error_code"] == "blocked_user"

    def test_user_key_not_found_falls_through_to_legacy(self, settings, key_service):
        user_key_svc = MagicMock()
        user_key_svc.validate_key.return_value = None  # Not a user key
        key_service.validate_key.return_value = {"id": 1, "name": "legacy", "enabled": 1}
        app = _create_test_app(key_service, settings, user_key_svc=user_key_svc)
        client = TestClient(app)
        r = client.get("/v1/test", headers={"x-api-key": "legacy-key"})
        assert r.status_code == 200
        assert r.json()["key_id"] == 1

    def test_user_key_exception_falls_through(self, settings, key_service):
        user_key_svc = MagicMock()
        user_key_svc.validate_key.side_effect = Exception("DB error")
        key_service.validate_key.return_value = {"id": 1, "name": "legacy", "enabled": 1}
        app = _create_test_app(key_service, settings, user_key_svc=user_key_svc)
        client = TestClient(app)
        r = client.get("/v1/test", headers={"x-api-key": "any-key"})
        assert r.status_code == 200  # falls through to legacy


class TestAdminToken:
    """Admin token endpoints."""

    def test_valid_admin_token(self, settings, key_service):
        app = _create_test_app(key_service, settings)
        client = TestClient(app)
        r = client.get("/v1/key/create", headers={"x-admin-token": "test-admin-token"})
        # Might be 405/404 since no POST handler, but should NOT be 401
        assert r.status_code != 401

    def test_invalid_admin_token_returns_401(self, settings, key_service):
        app = _create_test_app(key_service, settings)
        client = TestClient(app)
        r = client.get("/v1/key/create", headers={"x-admin-token": "wrong"})
        assert r.status_code == 401
```

---

## T18: Create Admin Guard Tests

### Goal

Test the admin dashboard cookie-based authentication guard.

**Create NEW file**: `backend/tests/test_admin_guard.py`

```python
"""Tests for admin dashboard authentication guard."""

import pytest
from unittest.mock import MagicMock
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient
from fastapi.responses import JSONResponse


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

    def test_no_cookie_returns_redirect_or_401(self, admin_settings):
        """Without auth cookie, admin routes should be denied."""
        app = _create_admin_app(admin_settings)
        client = TestClient(app)
        r = client.get("/admin/api/test")
        # Should return 401/403 or a redirect
        assert r.status_code in (401, 403, 307)

    def test_wrong_cookie_returns_401(self, admin_settings):
        app = _create_admin_app(admin_settings)
        client = TestClient(app)
        r = client.get("/admin/api/test", cookies={"admin_session": "wrong-token"})
        assert r.status_code in (401, 403)
```

> **Note**: The admin guard implementation may vary. Read `admin_routes/utils.py` to understand exactly how `_admin_guard` works (cookie name, hash format) and adjust tests accordingly.

---

## T19: Create CI Pipeline

### Goal

Add GitHub Actions CI that runs tests on push/PR.

**Create NEW file**: `.github/workflows/ci.yml`

```yaml
name: CI
on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: backend
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.11"
      - name: Install dependencies
        run: |
          pip install --upgrade pip
          pip install -r requirements.txt
          pip install pytest httpx
      - name: Run tests
        env:
          AUTH_HASH_SALT: test-salt
          ADMIN_TOKEN: test-token
          APP_ENV: test
        run: pytest tests/ -v --tb=short

  docker-build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Build Docker image
        run: docker build -t sa-helper:ci .
      - name: Health check
        run: |
          docker run -d --name ci-test \
            -e AUTH_HASH_SALT=test \
            -e ADMIN_TOKEN=test \
            -e APP_ENV=test \
            -p 8080:8080 sa-helper:ci
          sleep 10
          curl -sf http://localhost:8080/health || (docker logs ci-test && exit 1)
          docker stop ci-test
```

---

## Verification

```bash
# Run all tests
cd backend && python -m pytest tests/ -v --tb=short

# Expected: all tests pass (including existing test_services.py)
```

---

## Summary of Changes

| File | Change |
|------|--------|
| `backend/tests/conftest.py` | [NEW] ~100 lines — shared fixtures |
| `backend/tests/test_auth_middleware.py` | [NEW] ~120 lines — auth flow tests |
| `backend/tests/test_admin_guard.py` | [NEW] ~50 lines — admin guard tests |
| `.github/workflows/ci.yml` | [NEW] ~40 lines — CI pipeline |
