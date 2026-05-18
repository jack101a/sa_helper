from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import func

from app.core.config import get_settings
from app.core.db import get_session
from app.core.models import (
    ApiKeyAllowedDomainRecord,
    ApiKeyDeviceBindingRecord,
    ApiKeyRateLimitRecord,
    ApiKeyRecord,
    PlatformSettingRecord,
    UsageEventRecord,
)
from app.core.security import hash_api_key

from .base import BaseRepository


class APIKeyRepository(BaseRepository):
    DEFAULT_SERVICES = {
        "autofill": True,
        "captcha": True,
        "stall": True,
        "solver": True,
        "custom": False,
    }

    def _parse_services(self, value: str | None) -> dict[str, bool]:
        try:
            raw = json.loads(value or "{}")
            if not isinstance(raw, dict):
                raw = {}
        except Exception:
            raw = {}
        services = dict(self.DEFAULT_SERVICES)
        for key, enabled in raw.items():
            services[str(key)] = bool(enabled)
        return services

    def _row_to_dict(self, row: ApiKeyRecord) -> dict[str, Any]:
        return {
            "id": row.id,
            "name": row.name,
            "key_hash": row.key_hash,
            "enabled": row.enabled,
            "all_domains": row.all_domains,
            "created_at": row.created_at,
            "expires_at": row.expires_at,
            "revoked_at": row.revoked_at,
            "key_type": row.key_type,
            "plan_name": row.plan_name,
            "mobile": row.mobile,
            "telegram_id": row.telegram_id,
            "services_json": row.services_json,
        }

    def insert_api_key(self, name: str, key_hash: str, expires_at: str | None, key_type: str = "user") -> int:
        """Insert API key and return row id."""
        if self._use_sqlalchemy:
            session = get_session()
            try:
                now = datetime.now(UTC).isoformat()
                row = ApiKeyRecord(
                    name=name,
                    key_hash=key_hash,
                    key_type=key_type,
                    enabled=1,
                    created_at=now,
                    expires_at=expires_at,
                    revoked_at=None,
                )
                session.add(row)
                session.commit()
                session.refresh(row)
                return int(row.id)
            except Exception:
                session.rollback()
                raise
            finally:
                session.close()
        with self._lock:
            with self.connect() as conn:
                now = datetime.now(UTC).isoformat()
                cursor = conn.execute(
                    """
                    INSERT INTO api_keys (name, key_hash, key_type, enabled, created_at, expires_at, revoked_at)
                    VALUES (?, ?, ?, 1, ?, ?, NULL)
                    """,
                    (name, key_hash, key_type, now, expires_at),
                )
                conn.commit()
                return int(cursor.lastrowid)

    def get_api_key_by_hash(self, key_hash: str) -> dict[str, Any] | None:
        """Fetch API key record by hash."""
        if self._use_sqlalchemy:
            session = get_session()
            try:
                row = session.query(ApiKeyRecord).filter(ApiKeyRecord.key_hash == key_hash).first()
                return self._row_to_dict(row) if row else None
            finally:
                session.close()
        with self.connect() as conn:
            cursor = conn.execute(
                "SELECT * FROM api_keys WHERE key_hash = ?",
                (key_hash,),
            )
            row = cursor.fetchone()
            return dict(row) if row else None

    def revoke_api_key(self, key_hash: str) -> bool:
        """Disable API key hash."""
        if self._use_sqlalchemy:
            session = get_session()
            try:
                row = session.query(ApiKeyRecord).filter(ApiKeyRecord.key_hash == key_hash).first()
                if not row:
                    return False
                row.enabled = 0
                row.revoked_at = datetime.now(UTC).isoformat()
                session.commit()
                return True
            except Exception:
                session.rollback()
                raise
            finally:
                session.close()
        with self._lock:
            with self.connect() as conn:
                now = datetime.now(UTC).isoformat()
                result = conn.execute(
                    """
                    UPDATE api_keys
                    SET enabled = 0, revoked_at = ?
                    WHERE key_hash = ?
                    """,
                    (now, key_hash),
                )
                conn.commit()
                return result.rowcount > 0

    def revoke_api_key_by_id(self, key_id: int) -> bool:
        """Disable API key by integer id."""
        if self._use_sqlalchemy:
            session = get_session()
            try:
                row = session.get(ApiKeyRecord, key_id)
                if not row:
                    return False
                row.enabled = 0
                row.revoked_at = datetime.now(UTC).isoformat()
                session.commit()
                return True
            except Exception:
                session.rollback()
                raise
            finally:
                session.close()
        with self._lock:
            with self.connect() as conn:
                now = datetime.now(UTC).isoformat()
                result = conn.execute(
                    """
                    UPDATE api_keys
                    SET enabled = 0, revoked_at = ?
                    WHERE id = ?
                    """,
                    (now, key_id),
                )
                conn.commit()
                return result.rowcount > 0

    def delete_revoked_api_key_by_id(self, key_id: int) -> bool:
        """Delete revoked key and dependent rows. Active keys cannot be deleted."""
        if self._use_sqlalchemy:
            session = get_session()
            try:
                row = session.get(ApiKeyRecord, key_id)
                if not row or int(row.enabled or 0) == 1 or not row.revoked_at:
                    return False
                session.query(UsageEventRecord).filter(UsageEventRecord.key_id == key_id).delete()
                session.query(ApiKeyAllowedDomainRecord).filter(ApiKeyAllowedDomainRecord.key_id == key_id).delete()
                session.query(ApiKeyRateLimitRecord).filter(ApiKeyRateLimitRecord.key_id == key_id).delete()
                session.query(ApiKeyDeviceBindingRecord).filter(ApiKeyDeviceBindingRecord.key_id == key_id).delete()
                session.delete(row)
                session.commit()
                return True
            except Exception:
                session.rollback()
                raise
            finally:
                session.close()
        with self._lock:
            with self.connect() as conn:
                row = conn.execute(
                    "SELECT id, enabled, revoked_at FROM api_keys WHERE id = ?",
                    (key_id,),
                ).fetchone()
                if not row:
                    return False
                if int(row["enabled"]) == 1:
                    return False
                if not row["revoked_at"]:
                    return False

                conn.execute("DELETE FROM usage_events WHERE key_id = ?", (key_id,))
                conn.execute("DELETE FROM field_mapping_proposals WHERE reported_by = ?", (key_id,))
                conn.execute("DELETE FROM active_learning WHERE reported_by = ?", (key_id,))
                conn.execute("UPDATE retrain_jobs SET requested_by = NULL WHERE requested_by = ?", (key_id,))
                conn.execute(
                    "UPDATE retrain_samples SET labeled_by = NULL WHERE labeled_by = ?",
                    (key_id,),
                )
                conn.execute("DELETE FROM retrain_samples WHERE reported_by = ?", (key_id,))
                result = conn.execute("DELETE FROM api_keys WHERE id = ?", (key_id,))
                conn.commit()
                return result.rowcount > 0

    def insert_usage_event(
        self,
        key_id: int,
        task_type: str,
        status: str,
        processing_ms: int,
        model_used: str | None,
        domain: str | None,
        ip: str | None,
    ) -> None:
        """Persist usage event row."""
        if self._use_sqlalchemy:
            session = get_session()
            try:
                session.add(UsageEventRecord(
                    key_id=key_id,
                    task_type=task_type,
                    status=status,
                    processing_ms=processing_ms,
                    model_used=model_used,
                    domain=domain,
                    ip=ip,
                    created_at=datetime.now(UTC).isoformat(),
                ))
                session.commit()
                return
            except Exception:
                session.rollback()
                raise
            finally:
                session.close()
        with self._lock:
            with self.connect() as conn:
                now = datetime.now(UTC).isoformat()
                conn.execute(
                    """
                    INSERT INTO usage_events (key_id, task_type, status, processing_ms, model_used, domain, ip, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (key_id, task_type, status, processing_ms, model_used, domain, ip, now),
                )
                conn.commit()

    def get_usage_summary(self, key_id: int | None = None) -> dict[str, Any]:
        """Get usage summary, optionally filtered by key."""
        if self._use_sqlalchemy:
            session = get_session()
            try:
                query = session.query(UsageEventRecord)
                if key_id is not None:
                    query = query.filter(UsageEventRecord.key_id == key_id)
                total = query.count()
                success = query.filter(UsageEventRecord.status == "ok").count()
                avg_ms = query.with_entities(func.coalesce(func.avg(UsageEventRecord.processing_ms), 0)).scalar()
                return {
                    "total_requests": int(total),
                    "successful_requests": int(success),
                    "failed_requests": int(total - success),
                    "avg_processing_ms": float(avg_ms or 0),
                }
            finally:
                session.close()
        with self.connect() as conn:
            query_base = "FROM usage_events"
            params: tuple[Any, ...] = ()
            if key_id is not None:
                query_base += " WHERE key_id = ?"
                params = (key_id,)

            total = conn.execute(f"SELECT COUNT(*) AS total {query_base}", params).fetchone()["total"]
            
            success_query = f"SELECT COUNT(*) AS success {query_base}"
            if key_id is not None:
                success_query += " AND status = 'ok'"
            else:
                success_query += " WHERE status = 'ok'"
                
            success = conn.execute(success_query, params).fetchone()["success"]
            
            avg_ms = conn.execute(f"SELECT COALESCE(AVG(processing_ms), 0) AS avg_ms {query_base}", params).fetchone()["avg_ms"]
            
            return {
                "total_requests": int(total),
                "successful_requests": int(success),
                "failed_requests": int(total - success),
                "avg_processing_ms": float(avg_ms),
            }

    def get_all_api_keys(self) -> list[dict[str, Any]]:
        """Get all API keys for admin view."""
        if self._use_sqlalchemy:
            session = get_session()
            try:
                rows = []
                for row in session.query(ApiKeyRecord).order_by(ApiKeyRecord.id.desc()).all():
                    item = self._row_to_dict(row)
                    item["services"] = self._parse_services(item.get("services_json"))
                    item.pop("services_json", None)
                    rows.append(item)
                return rows
            finally:
                session.close()
        with self.connect() as conn:
            rows = []
            for row in conn.execute(
                """
                SELECT id, name, key_type, enabled, all_domains, created_at, expires_at, revoked_at,
                       plan_name, mobile, telegram_id, services_json
                FROM api_keys
                ORDER BY id DESC
                """
            ):
                item = dict(row)
                item["services"] = self._parse_services(item.get("services_json"))
                item.pop("services_json", None)
                rows.append(item)
            return rows

    def set_api_key_domain_scope(self, key_id: int, all_domains: bool, domains: list[str] | None = None) -> None:
        clean_domains = sorted({self._normalize_domain(d) for d in (domains or []) if self._normalize_domain(d)})
        if self._use_sqlalchemy:
            session = get_session()
            try:
                row = session.get(ApiKeyRecord, key_id)
                if row:
                    row.all_domains = 1 if all_domains else 0
                session.query(ApiKeyAllowedDomainRecord).filter(ApiKeyAllowedDomainRecord.key_id == key_id).delete()
                if not all_domains:
                    for domain in clean_domains:
                        session.add(ApiKeyAllowedDomainRecord(key_id=key_id, domain=domain))
                session.commit()
                return
            except Exception:
                session.rollback()
                raise
            finally:
                session.close()
        with self._lock:
            with self.connect() as conn:
                conn.execute("UPDATE api_keys SET all_domains = ? WHERE id = ?", (1 if all_domains else 0, key_id))
                conn.execute("DELETE FROM api_key_allowed_domains WHERE key_id = ?", (key_id,))
                if not all_domains:
                    for domain in clean_domains:
                        conn.execute(
                            "INSERT INTO api_key_allowed_domains (key_id, domain) VALUES (?, ?)",
                            (key_id, domain),
                        )
                conn.commit()

    def get_api_key_allowed_domains(self, key_id: int) -> list[str]:
        if self._use_sqlalchemy:
            session = get_session()
            try:
                rows = (
                    session.query(ApiKeyAllowedDomainRecord)
                    .filter(ApiKeyAllowedDomainRecord.key_id == key_id)
                    .order_by(ApiKeyAllowedDomainRecord.domain.asc())
                    .all()
                )
                return [str(row.domain) for row in rows]
            finally:
                session.close()
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT domain FROM api_key_allowed_domains WHERE key_id = ? ORDER BY domain ASC",
                (key_id,),
            )
            return [str(row["domain"]) for row in rows]

    def is_domain_allowed_for_key(self, key_id: int, domain: str | None) -> bool:
        if self._use_sqlalchemy:
            session = get_session()
            try:
                row = session.get(ApiKeyRecord, key_id)
                if not row:
                    return False
                if int(row.all_domains or 0) == 1:
                    return True
                for candidate in self._domain_candidates(domain):
                    hit = (
                        session.query(ApiKeyAllowedDomainRecord)
                        .filter(
                            ApiKeyAllowedDomainRecord.key_id == key_id,
                            ApiKeyAllowedDomainRecord.domain == candidate,
                        )
                        .first()
                    )
                    if hit:
                        return True
                return False
            finally:
                session.close()
        with self.connect() as conn:
            row = conn.execute("SELECT all_domains FROM api_keys WHERE id = ?", (key_id,)).fetchone()
            if not row:
                return False
            if int(row["all_domains"]) == 1:
                return True
            for candidate in self._domain_candidates(domain):
                hit = conn.execute(
                    "SELECT 1 FROM api_key_allowed_domains WHERE key_id = ? AND domain = ? LIMIT 1",
                    (key_id, candidate),
                ).fetchone()
                if hit:
                    return True
            return False

    def set_api_key_rate_limit(self, key_id: int, requests_per_minute: int, burst: int = 0) -> None:
        rpm = max(1, int(requests_per_minute))
        b = max(0, int(burst))
        if self._use_sqlalchemy:
            session = get_session()
            try:
                row = session.get(ApiKeyRateLimitRecord, key_id)
                if row:
                    row.requests_per_minute = rpm
                    row.burst = b
                else:
                    session.add(ApiKeyRateLimitRecord(key_id=key_id, requests_per_minute=rpm, burst=b))
                session.commit()
                return
            except Exception:
                session.rollback()
                raise
            finally:
                session.close()
        with self._lock:
            with self.connect() as conn:
                conn.execute(
                    """
                    INSERT INTO api_key_rate_limits (key_id, requests_per_minute, burst)
                    VALUES (?, ?, ?)
                    ON CONFLICT(key_id) DO UPDATE SET
                        requests_per_minute = excluded.requests_per_minute,
                        burst = excluded.burst
                    """,
                    (key_id, rpm, b),
                )
                conn.commit()

    def get_api_key_rate_limit(self, key_id: int) -> dict[str, int] | None:
        if self._use_sqlalchemy:
            session = get_session()
            try:
                row = session.get(ApiKeyRateLimitRecord, key_id)
                if not row:
                    return None
                return {"requests_per_minute": int(row.requests_per_minute), "burst": int(row.burst)}
            finally:
                session.close()
        with self.connect() as conn:
            row = conn.execute(
                "SELECT requests_per_minute, burst FROM api_key_rate_limits WHERE key_id = ?",
                (key_id,),
            ).fetchone()
            if not row:
                return None
            return {
                "requests_per_minute": int(row["requests_per_minute"]),
                "burst": int(row["burst"]),
            }

    def set_api_key_entitlements(
        self,
        key_id: int,
        plan_name: str = "",
        mobile: str = "",
        telegram_id: str = "",
        services: dict[str, bool] | None = None,
    ) -> None:
        clean_services = dict(self.DEFAULT_SERVICES)
        for name, enabled in (services or {}).items():
            clean_services[str(name)] = bool(enabled)
        if self._use_sqlalchemy:
            session = get_session()
            try:
                row = session.get(ApiKeyRecord, key_id)
                if row:
                    row.plan_name = str(plan_name or "Standard").strip() or "Standard"
                    row.mobile = str(mobile or "").strip()
                    row.telegram_id = str(telegram_id or "").strip()
                    row.services_json = json.dumps(clean_services, separators=(",", ":"))
                session.commit()
                return
            except Exception:
                session.rollback()
                raise
            finally:
                session.close()
        with self._lock:
            with self.connect() as conn:
                conn.execute(
                    """
                    UPDATE api_keys
                    SET plan_name = ?, mobile = ?, telegram_id = ?, services_json = ?
                    WHERE id = ?
                    """,
                    (
                        str(plan_name or "Standard").strip() or "Standard",
                        str(mobile or "").strip(),
                        str(telegram_id or "").strip(),
                        json.dumps(clean_services, separators=(",", ":")),
                        key_id,
                    ),
                )
                conn.commit()

    def get_api_key_entitlements(self, key_id: int) -> dict[str, Any]:
        if self._use_sqlalchemy:
            session = get_session()
            try:
                row = session.get(ApiKeyRecord, key_id)
                if not row:
                    return {
                        "plan_name": "Standard",
                        "mobile": "",
                        "telegram_id": "",
                        "services": dict(self.DEFAULT_SERVICES),
                    }
                return {
                    "plan_name": row.plan_name or "Standard",
                    "mobile": row.mobile or "",
                    "telegram_id": row.telegram_id or "",
                    "services": self._parse_services(row.services_json),
                }
            finally:
                session.close()
        with self.connect() as conn:
            row = conn.execute(
                """
                SELECT plan_name, mobile, telegram_id, services_json
                FROM api_keys
                WHERE id = ?
                """,
                (key_id,),
            ).fetchone()
            if not row:
                return {
                    "plan_name": "Standard",
                    "mobile": "",
                    "telegram_id": "",
                    "services": dict(self.DEFAULT_SERVICES),
                }
            return {
                "plan_name": row["plan_name"] or "Standard",
                "mobile": row["mobile"] or "",
                "telegram_id": row["telegram_id"] or "",
                "services": self._parse_services(row["services_json"]),
            }

    def validate_or_bind_key_device(
        self,
        key_id: int,
        device_id: str,
        user_agent: str | None = None,
    ) -> bool:
        """Bind key to first-seen device and reject any different device later."""
        token = str(device_id or "").strip()
        if not token:
            return False
        if self._use_sqlalchemy:
            session = get_session()
            try:
                key_row = session.get(ApiKeyRecord, key_id)
                if key_row and key_row.key_type == "master":
                    return True
                now = datetime.now(UTC).isoformat()
                row = session.get(ApiKeyDeviceBindingRecord, key_id)
                if not row:
                    session.add(ApiKeyDeviceBindingRecord(
                        key_id=key_id,
                        device_id=token,
                        user_agent=(user_agent or "")[:512],
                        first_seen_at=now,
                        last_seen_at=now,
                    ))
                    session.commit()
                    return True
                if str(row.device_id) != token:
                    return False
                row.user_agent = (user_agent or "")[:512]
                row.last_seen_at = now
                session.commit()
                return True
            except Exception:
                session.rollback()
                raise
            finally:
                session.close()
        with self.connect() as conn:
            key_row = conn.execute("SELECT key_type FROM api_keys WHERE id = ?", (key_id,)).fetchone()
            if key_row and key_row["key_type"] == "master":
                return True
        now = datetime.now(UTC).isoformat()
        with self._lock:
            with self.connect() as conn:
                row = conn.execute(
                    "SELECT device_id FROM api_key_device_bindings WHERE key_id = ?",
                    (key_id,),
                ).fetchone()
                if not row:
                    conn.execute(
                        """
                        INSERT INTO api_key_device_bindings (key_id, device_id, user_agent, first_seen_at, last_seen_at)
                        VALUES (?, ?, ?, ?, ?)
                        """,
                        (key_id, token, (user_agent or "")[:512], now, now),
                    )
                    conn.commit()
                    return True
                if str(row["device_id"]) != token:
                    return False
                conn.execute(
                    """
                    UPDATE api_key_device_bindings
                    SET user_agent = ?, last_seen_at = ?
                    WHERE key_id = ?
                    """,
                    ((user_agent or "")[:512], now, key_id),
                )
                conn.commit()
                return True

    def get_api_key_device_binding(self, key_id: int) -> dict[str, Any] | None:
        if self._use_sqlalchemy:
            session = get_session()
            try:
                row = session.get(ApiKeyDeviceBindingRecord, key_id)
                if not row:
                    return None
                return {
                    "device_id": row.device_id,
                    "user_agent": row.user_agent,
                    "first_seen_at": row.first_seen_at,
                    "last_seen_at": row.last_seen_at,
                }
            finally:
                session.close()
        with self.connect() as conn:
            row = conn.execute(
                """
                SELECT device_id, user_agent, first_seen_at, last_seen_at
                FROM api_key_device_bindings
                WHERE key_id = ?
                """,
                (key_id,),
            ).fetchone()
            return dict(row) if row else None

    # ── Master Key ────────────────────────────────────────────────────────────
    # The master key is stored plaintext in platform_settings so it survives
    # any DB migration, backup/restore, or server move.
    # Key: "master_api_key_plain"   Value: raw key string
    # Key: "master_api_key_id"      Value: api_keys.id (int as str)

    _MASTER_KEY_PREFIX = "tata_master_"

    def ensure_master_key(self) -> dict:
        """Idempotently create the master API key.

        If already created (found in platform_settings), returns the existing
        info without touching api_keys. On first run, creates a real api_key
        row (no expiry) and saves the plaintext in platform_settings.
        Returns: { id, key, name }
        """
        if self._use_sqlalchemy:
            try:
                session = get_session()
            except RuntimeError:
                session = None
            if session is not None:
                try:
                    row_plain = session.get(PlatformSettingRecord, "master_api_key_plain")
                    row_id = session.get(PlatformSettingRecord, "master_api_key_id")
                    if row_plain and row_id:
                        return {"id": int(row_id.value), "key": row_plain.value, "name": "Master Key"}

                    import secrets
                    raw = self._MASTER_KEY_PREFIX + secrets.token_hex(24)
                    key_hash = hash_api_key(raw, get_settings().auth.hash_salt)
                    now = datetime.now(UTC).isoformat()
                    key_row = ApiKeyRecord(
                        name="Master Key",
                        key_hash=key_hash,
                        key_type="master",
                        enabled=1,
                        created_at=now,
                        expires_at=None,
                        revoked_at=None,
                    )
                    session.add(key_row)
                    session.flush()
                    for key, value in [
                        ("master_api_key_plain", raw),
                        ("master_api_key_id", str(key_row.id)),
                    ]:
                        existing = session.get(PlatformSettingRecord, key)
                        if existing:
                            existing.value = value
                            existing.updated_at = now
                        else:
                            session.add(PlatformSettingRecord(
                                key=key,
                                value=value,
                                description="Auto-managed - do not edit manually",
                                updated_at=now,
                            ))
                    session.commit()
                    return {"id": int(key_row.id), "key": raw, "name": "Master Key"}
                except Exception:
                    session.rollback()
                    raise
                finally:
                    session.close()
        with self.connect() as conn:
            row_plain = conn.execute(
                "SELECT value FROM platform_settings WHERE key = 'master_api_key_plain'"
            ).fetchone()
            row_id = conn.execute(
                "SELECT value FROM platform_settings WHERE key = 'master_api_key_id'"
            ).fetchone()

        if row_plain and row_id:
            return {"id": int(row_id["value"]), "key": row_plain["value"], "name": "Master Key"}

        # Generate a new master key
        import secrets
        raw = self._MASTER_KEY_PREFIX + secrets.token_hex(24)
        key_hash = hash_api_key(raw, get_settings().auth.hash_salt)

        with self._lock:
            with self.connect() as conn:
                now = datetime.now(UTC).isoformat()
                cursor = conn.execute(
                    """
                    INSERT INTO api_keys (name, key_hash, key_type, enabled, created_at, expires_at, revoked_at)
                    VALUES (?, ?, 'master', 1, ?, NULL, NULL)
                    """,
                    ("Master Key", key_hash, now),
                )
                key_id = int(cursor.lastrowid)
                # Persist plaintext + id in platform_settings (survives migrations)
                for k, v in [
                    ("master_api_key_plain", raw),
                    ("master_api_key_id",    str(key_id)),
                ]:
                    conn.execute(
                        """
                        INSERT INTO platform_settings (key, value, description, updated_at)
                        VALUES (?, ?, ?, ?)
                        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
                        """,
                        (k, v, "Auto-managed — do not edit manually", now),
                    )
                conn.commit()

        return {"id": key_id, "key": raw, "name": "Master Key"}

    def get_master_key_info(self) -> dict | None:
        """Return master key info if it exists, else None."""
        if self._use_sqlalchemy:
            try:
                session = get_session()
            except RuntimeError:
                session = None
            if session is not None:
                try:
                    row_plain = session.get(PlatformSettingRecord, "master_api_key_plain")
                    row_id = session.get(PlatformSettingRecord, "master_api_key_id")
                    if row_plain and row_id:
                        return {"id": int(row_id.value), "key": row_plain.value, "name": "Master Key"}
                    return None
                finally:
                    session.close()
        with self.connect() as conn:
            row_plain = conn.execute(
                "SELECT value FROM platform_settings WHERE key = 'master_api_key_plain'"
            ).fetchone()
            row_id = conn.execute(
                "SELECT value FROM platform_settings WHERE key = 'master_api_key_id'"
            ).fetchone()
        if row_plain and row_id:
            return {"id": int(row_id["value"]), "key": row_plain["value"], "name": "Master Key"}
        return None

    def is_master_key_hash(self, key_hash: str) -> bool:
        """Return True if the given hash belongs to a master key."""
        if self._use_sqlalchemy:
            session = get_session()
            try:
                row = session.query(ApiKeyRecord).filter(ApiKeyRecord.key_hash == key_hash).first()
                return bool(row and row.key_type == "master")
            finally:
                session.close()
        with self.connect() as conn:
            row = conn.execute("SELECT key_type FROM api_keys WHERE key_hash = ?", (key_hash,)).fetchone()
            if row and row["key_type"] == "master":
                return True
        return False
