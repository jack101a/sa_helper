"""User-linked API key lifecycle — create, rotate, revoke, device binding."""

from __future__ import annotations

import threading
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.models import UserApiKey, UserApiKeyDevice, User
from app.core.security import generate_plain_api_key, hash_api_key, compute_expiry_datetime


class UserKeyService:
    """Manages user-linked API keys with device binding and rotation."""

    def __init__(self, session_factory, settings: Settings):
        self._session_factory = session_factory
        self._settings = settings
        self._lock = threading.Lock()

    def _session(self) -> Session:
        return self._session_factory()

    # ── Key Creation ──────────────────────────────────────────────────────

    def create_key(
        self,
        user_id: int,
        expiry_days: int | None = None,
        created_by_admin_id: int | None = None,
    ) -> tuple[UserApiKey, str]:
        """Create a new API key for a user. Revokes any existing active key.
        Returns (key_record, plain_key)."""
        with self._lock:
            session = self._session()
            try:
                # Revoke existing active keys for this user
                session.query(UserApiKey).filter(
                    UserApiKey.user_id == user_id,
                    UserApiKey.status == "active",
                ).update({"status": "rotated", "revoked_at": datetime.now(timezone.utc)})

                # Generate new key
                plain = generate_plain_api_key(self._settings)
                key_hash = hash_api_key(plain, self._settings.auth.hash_salt)
                days = expiry_days or self._settings.auth.default_expiry_days
                expires_at = compute_expiry_datetime(days)

                key = UserApiKey(
                    user_id=user_id,
                    key_hash=key_hash,
                    key_prefix_display=plain[:10] + "...",
                    status="active",
                    key_version=1,
                    issued_at=datetime.now(timezone.utc),
                    expires_at=expires_at,
                    created_by_admin_id=created_by_admin_id,
                )
                session.add(key)
                session.commit()
                session.refresh(key)
                return key, plain
            except Exception:
                session.rollback()
                raise
            finally:
                session.close()

    def rotate_key(
        self,
        user_id: int,
        created_by_admin_id: int | None = None,
    ) -> tuple[UserApiKey, str]:
        """Rotate: revoke old key, issue new one with incremented version."""
        with self._lock:
            session = self._session()
            try:
                old = (
                    session.query(UserApiKey)
                    .filter(UserApiKey.user_id == user_id, UserApiKey.status == "active")
                    .first()
                )
                old_version = old.key_version if old else 0
                old_id = old.id if old else None

                # Revoke old
                if old:
                    old.status = "rotated"
                    old.revoked_at = datetime.now(timezone.utc)
                    old.revoked_reason = "key_rotation"

                # Issue new
                plain = generate_plain_api_key(self._settings)
                key_hash = hash_api_key(plain, self._settings.auth.hash_salt)
                days = self._settings.auth.default_expiry_days
                expires_at = compute_expiry_datetime(days)

                key = UserApiKey(
                    user_id=user_id,
                    key_hash=key_hash,
                    key_prefix_display=plain[:10] + "...",
                    status="active",
                    key_version=old_version + 1,
                    issued_at=datetime.now(timezone.utc),
                    expires_at=expires_at,
                    rotated_from_key_id=old_id,
                    created_by_admin_id=created_by_admin_id,
                )
                session.add(key)
                session.commit()
                session.refresh(key)
                return key, plain
            except Exception:
                session.rollback()
                raise
            finally:
                session.close()

    def revoke_key(self, key_id: int, reason: str = "") -> UserApiKey | None:
        session = self._session()
        try:
            key = session.query(UserApiKey).filter(UserApiKey.id == key_id).first()
            if not key:
                return None
            key.status = "revoked"
            key.revoked_at = datetime.now(timezone.utc)
            key.revoked_reason = reason
            session.commit()
            session.refresh(key)
            return key
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    # ── Validation ────────────────────────────────────────────────────────

    def validate_key(self, plain_key: str) -> dict | None:
        """Validate a user-linked API key. Returns dict with user status info.
        Also updates last_used_at and usage_count."""
        key_hash = hash_api_key(plain_key, self._settings.auth.hash_salt)
        session = self._session()
        try:
            key = (
                session.query(UserApiKey)
                .filter(UserApiKey.key_hash == key_hash, UserApiKey.status == "active")
                .first()
            )
            if not key:
                return None

            # Check expiry
            if key.expires_at:
                expires_at = key.expires_at
                if expires_at.tzinfo is None:
                    expires_at = expires_at.replace(tzinfo=timezone.utc)
                if expires_at < datetime.now(timezone.utc):
                    return None

            # Check user status
            user = session.query(User).filter(User.id == key.user_id).first()
            if not user or user.status not in ("active",):
                return None

            # Update usage tracking
            key.last_used_at = datetime.now(timezone.utc)
            key.usage_count = (key.usage_count or 0) + 1
            session.commit()

            return {
                "id": key.id,
                "user_id": key.user_id,
                "key_hash": key.key_hash,
                "name": user.full_name or f"User {user.id}",
                "key_type": "user_linked",
                "expires_at": key.expires_at.isoformat() if key.expires_at else None,
                "status": key.status,
                "key_version": key.key_version,
                "user_status": user.status if user else "unknown",
            }
        finally:
            session.close()

    def get_user_key(self, user_id: int) -> UserApiKey | None:
        session = self._session()
        try:
            return (
                session.query(UserApiKey)
                .filter(UserApiKey.user_id == user_id, UserApiKey.status == "active")
                .first()
            )
        finally:
            session.close()

    # ── Device Binding ────────────────────────────────────────────────────

    def bind_device(
        self,
        api_key_id: int,
        device_fingerprint: str,
        device_name: str = "",
        user_agent: str = "",
    ) -> UserApiKeyDevice:
        session = self._session()
        try:
            now = datetime.now(timezone.utc)
            # Check if already bound
            existing = (
                session.query(UserApiKeyDevice)
                .filter(
                    UserApiKeyDevice.api_key_id == api_key_id,
                    UserApiKeyDevice.device_fingerprint == device_fingerprint,
                )
                .first()
            )
            if existing:
                existing.last_seen_at = now
                session.commit()
                return existing

            # Check device limit from user's plan
            max_devices = 1  # default
            try:
                from app.core.models import UserSubscription, SubscriptionPlan
                key = session.query(UserApiKey).filter(UserApiKey.id == api_key_id).first()
                if key and key.user_id:
                    sub = (
                        session.query(UserSubscription)
                        .filter(
                            UserSubscription.user_id == key.user_id,
                            UserSubscription.status == "active",
                        )
                        .order_by(UserSubscription.created_at.desc())
                        .first()
                    )
                    if sub and sub.plan_id:
                        plan = session.query(SubscriptionPlan).filter(
                            SubscriptionPlan.id == sub.plan_id
                        ).first()
                        if plan and plan.max_devices:
                            max_devices = plan.max_devices
            except Exception:
                pass  # Fall back to default of 1

            active_devices = (
                session.query(UserApiKeyDevice)
                .filter(
                    UserApiKeyDevice.api_key_id == api_key_id,
                    UserApiKeyDevice.status == "active",
                )
                .all()
            )
            # Check if this device is already bound
            for dev in active_devices:
                if dev.device_fingerprint == device_fingerprint:
                    dev.last_seen_at = now
                    session.commit()
                    return dev
            # Check if device limit reached
            if len(active_devices) >= max_devices:
                return None  # Caller should handle as "device_limit_reached"

            device = UserApiKeyDevice(
                api_key_id=api_key_id,
                device_fingerprint=device_fingerprint,
                device_name=device_name,
                user_agent=user_agent,
                first_seen_at=now,
                last_seen_at=now,
                status="active",
            )
            session.add(device)
            session.commit()
            session.refresh(device)
            return device
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    def validate_device(self, api_key_id: int, device_fingerprint: str) -> bool:
        """Check if device is authorized for this key."""
        session = self._session()
        try:
            device = (
                session.query(UserApiKeyDevice)
                .filter(
                    UserApiKeyDevice.api_key_id == api_key_id,
                    UserApiKeyDevice.device_fingerprint == device_fingerprint,
                    UserApiKeyDevice.status == "active",
                )
                .first()
            )
            if device:
                device.last_seen_at = datetime.now(timezone.utc)
                session.commit()
                return True
            return False
        except Exception:
            session.rollback()
            return False
        finally:
            session.close()

    def reset_device_binding(self, api_key_id: int) -> None:
        """Admin override: clear all device bindings for a key."""
        session = self._session()
        try:
            session.query(UserApiKeyDevice).filter(
                UserApiKeyDevice.api_key_id == api_key_id
            ).update({"status": "replaced"})
            session.commit()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    def get_user_devices(self, user_id: int) -> list[UserApiKeyDevice]:
        session = self._session()
        try:
            key = self.get_user_key(user_id)
            if not key:
                return []
            return (
                session.query(UserApiKeyDevice)
                .filter(UserApiKeyDevice.api_key_id == key.id)
                .order_by(UserApiKeyDevice.last_seen_at.desc())
                .all()
            )
        finally:
            session.close()
