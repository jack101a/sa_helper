"""Security helpers for API keys and request payloads."""

from __future__ import annotations

import base64
import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from app.core.config import Settings


def generate_plain_api_key(settings: Settings) -> str:
    """Generate a new API key string."""

    token = secrets.token_urlsafe(settings.auth.key_length)
    return f"{settings.auth.key_prefix}{token}"


def hash_api_key(plain_key: str, salt: str) -> str:
    """Hash API key with SHA-256 + salt."""

    raw = f"{salt}:{plain_key}".encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def compute_expiry(days: int) -> str:
    """Return UTC ISO expiration timestamp."""

    expires = datetime.now(timezone.utc) + timedelta(days=days)
    return expires.isoformat()


def is_expired(expires_at: str | None) -> bool:
    """Check expiration timestamp."""

    if not expires_at:
        return False
    return datetime.fromisoformat(expires_at) < datetime.now(timezone.utc)


def is_valid_base64(payload: str) -> bool:
    """Validate if payload is decodable base64."""

    try:
        base64.b64decode(payload, validate=True)
        return True
    except Exception:
        return False

