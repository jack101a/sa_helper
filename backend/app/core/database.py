"""SQLite database access layer."""

from __future__ import annotations

import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator
from urllib.parse import urlsplit

from app.core.config import Settings


class Database:
    """Thread-safe SQLite wrapper."""

    def __init__(self, settings: Settings) -> None:
        self._path = Path(settings.storage.sqlite_path)
        self._lock = threading.Lock()
        self._path.parent.mkdir(parents=True, exist_ok=True)

    @staticmethod
    def _normalize_domain(domain: str | None) -> str:
        token = str(domain or "").strip().lower()
        if not token:
            return ""
        if "://" in token:
            try:
                token = urlsplit(token).hostname or token
            except Exception:
                pass
        token = token.split("/", 1)[0].split(":", 1)[0].strip(".")
        if token.startswith("www."):
            token = token[4:]
        return token

    @classmethod
    def _domain_candidates(cls, domain: str | None) -> list[str]:
        normalized = cls._normalize_domain(domain)
        if not normalized:
            return []
        out: list[str] = []
        seen: set[str] = set()

        def _add(value: str) -> None:
            if value and value not in seen:
                seen.add(value)
                out.append(value)

        _add(normalized)
        _add(f"www.{normalized}")
        labels = normalized.split(".")
        for idx in range(1, len(labels) - 1):
            suffix = ".".join(labels[idx:])
            _add(suffix)
            _add(f"www.{suffix}")
        return out

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        """Yield sqlite connection with row_factory."""

        connection = sqlite3.connect(self._path, check_same_thread=False)
        connection.row_factory = sqlite3.Row
        try:
            yield connection
        finally:
            connection.close()

    def init(self) -> None:
        """Create tables when missing."""

        with self._lock:
            with self.connect() as conn:
                conn.executescript(
                    """
                    CREATE TABLE IF NOT EXISTS api_keys (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        name TEXT NOT NULL,
                        key_hash TEXT NOT NULL UNIQUE,
                        enabled INTEGER NOT NULL DEFAULT 1,
                        all_domains INTEGER NOT NULL DEFAULT 1,
                        created_at TEXT NOT NULL,
                        expires_at TEXT,
                        revoked_at TEXT
                    );
                    
                    CREATE TABLE IF NOT EXISTS api_key_allowed_domains (
                        key_id INTEGER NOT NULL,
                        domain TEXT NOT NULL,
                        PRIMARY KEY (key_id, domain),
                        FOREIGN KEY(key_id) REFERENCES api_keys(id)
                    );

                    CREATE TABLE IF NOT EXISTS api_key_rate_limits (
                        key_id INTEGER PRIMARY KEY,
                        requests_per_minute INTEGER NOT NULL,
                        burst INTEGER NOT NULL DEFAULT 0,
                        FOREIGN KEY(key_id) REFERENCES api_keys(id)
                    );

                    CREATE TABLE IF NOT EXISTS api_key_device_bindings (
                        key_id INTEGER PRIMARY KEY,
                        device_id TEXT NOT NULL,
                        user_agent TEXT,
                        first_seen_at TEXT NOT NULL,
                        last_seen_at TEXT NOT NULL,
                        FOREIGN KEY(key_id) REFERENCES api_keys(id)
                    );

                    CREATE TABLE IF NOT EXISTS usage_events (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        key_id INTEGER NOT NULL,
                        task_type TEXT NOT NULL,
                        status TEXT NOT NULL,
                        processing_ms INTEGER NOT NULL,
                        model_used TEXT,
                        domain TEXT,
                        ip TEXT,
                        created_at TEXT NOT NULL,
                        FOREIGN KEY(key_id) REFERENCES api_keys(id)
                    );

                    CREATE TABLE IF NOT EXISTS model_routes (
                        domain TEXT PRIMARY KEY,
                        ai_model_filename TEXT NOT NULL
                    );

                    CREATE TABLE IF NOT EXISTS model_registry (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        ai_model_name TEXT NOT NULL,
                        version TEXT NOT NULL,
                        task_type TEXT NOT NULL,
                        ai_runtime TEXT NOT NULL DEFAULT 'onnx',
                        ai_model_filename TEXT NOT NULL UNIQUE,
                        status TEXT NOT NULL DEFAULT 'active',
                        lifecycle_state TEXT NOT NULL DEFAULT 'production',
                        notes TEXT,
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL
                    );

                    CREATE TABLE IF NOT EXISTS field_mappings (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        domain TEXT NOT NULL,
                        field_name TEXT NOT NULL,
                        task_type TEXT NOT NULL,
                        source_data_type TEXT NOT NULL DEFAULT 'image',
                        source_selector TEXT NOT NULL DEFAULT '',
                        target_data_type TEXT NOT NULL DEFAULT 'text',
                        target_selector TEXT NOT NULL DEFAULT '',
                        ai_model_id INTEGER NOT NULL,
                        created_at TEXT NOT NULL,
                        UNIQUE(domain, field_name, task_type),
                        FOREIGN KEY(ai_model_id) REFERENCES model_registry(id)
                    );

                    CREATE TABLE IF NOT EXISTS field_mapping_proposals (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        domain TEXT NOT NULL,
                        task_type TEXT NOT NULL,
                        source_data_type TEXT NOT NULL,
                        source_selector TEXT NOT NULL,
                        target_data_type TEXT NOT NULL,
                        target_selector TEXT NOT NULL,
                        proposed_field_name TEXT NOT NULL,
                        reported_by INTEGER NOT NULL,
                        status TEXT NOT NULL DEFAULT 'pending',
                        created_at TEXT NOT NULL,
                        FOREIGN KEY(reported_by) REFERENCES api_keys(id)
                    );

                    CREATE TABLE IF NOT EXISTS retrain_samples (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        domain TEXT NOT NULL,
                        image_path TEXT NOT NULL,
                        task_type TEXT NOT NULL DEFAULT 'image',
                        field_name TEXT,
                        reported_by INTEGER NOT NULL,
                        status TEXT NOT NULL DEFAULT 'queued',
                        label_text TEXT,
                        labeled_by INTEGER,
                        labeled_at TEXT,
                        consumed_by_job_id INTEGER,
                        created_at TEXT NOT NULL,
                        FOREIGN KEY(reported_by) REFERENCES api_keys(id)
                    );

                    CREATE TABLE IF NOT EXISTS retrain_jobs (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        status TEXT NOT NULL DEFAULT 'queued',
                        scheduled_for TEXT NOT NULL,
                        started_at TEXT,
                        finished_at TEXT,
                        requested_by INTEGER,
                        min_samples INTEGER NOT NULL DEFAULT 20,
                        notes TEXT,
                        error_message TEXT,
                        produced_ai_model_id INTEGER,
                        total_samples INTEGER NOT NULL DEFAULT 0
                    );

                    CREATE TABLE IF NOT EXISTS model_lifecycle_events (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        ai_model_id INTEGER NOT NULL,
                        from_state TEXT,
                        to_state TEXT NOT NULL,
                        reason TEXT,
                        changed_by INTEGER,
                        created_at TEXT NOT NULL,
                        FOREIGN KEY(ai_model_id) REFERENCES model_registry(id)
                    );

                    CREATE TABLE IF NOT EXISTS active_learning (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        domain TEXT NOT NULL,
                        image_path TEXT NOT NULL,
                        reported_by INTEGER NOT NULL,
                        created_at TEXT NOT NULL,
                        FOREIGN KEY(reported_by) REFERENCES api_keys(id)
                    );

                    CREATE TABLE IF NOT EXISTS access_control (
                        key TEXT PRIMARY KEY,
                        value TEXT NOT NULL
                    );

                    CREATE TABLE IF NOT EXISTS allowed_domains (
                        domain TEXT PRIMARY KEY
                    );

                    CREATE TABLE IF NOT EXISTS locators (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        domain TEXT NOT NULL,
                        image_selector TEXT NOT NULL,
                        input_selector TEXT NOT NULL,
                        status TEXT NOT NULL DEFAULT 'pending',
                        created_at TEXT NOT NULL
                    );

                    CREATE TABLE IF NOT EXISTS failed_payload_labels (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        filename TEXT NOT NULL UNIQUE,
                        domain TEXT NOT NULL,
                        ai_guess TEXT,
                        corrected_text TEXT NOT NULL,
                        updated_at TEXT NOT NULL
                    );

                    CREATE TABLE IF NOT EXISTS platform_settings (
                        key TEXT PRIMARY KEY,
                        value TEXT NOT NULL DEFAULT '',
                        description TEXT,
                        updated_at TEXT NOT NULL
                    );
                    """
                )
                # Backward-compatible migration for older usage_events schema.
                usage_columns = {
                    row["name"] for row in conn.execute("PRAGMA table_info(usage_events)")
                }
                if "model_used" not in usage_columns:
                    conn.execute("ALTER TABLE usage_events ADD COLUMN model_used TEXT")
                if "domain" not in usage_columns:
                    conn.execute("ALTER TABLE usage_events ADD COLUMN domain TEXT")
                if "ip" not in usage_columns:
                    conn.execute("ALTER TABLE usage_events ADD COLUMN ip TEXT")
                
                key_columns = {row["name"] for row in conn.execute("PRAGMA table_info(api_keys)")}
                if "all_domains" not in key_columns:
                    conn.execute("ALTER TABLE api_keys ADD COLUMN all_domains INTEGER NOT NULL DEFAULT 1")

                # Backward-compatible migration for renamed model columns.
                route_columns = {row["name"] for row in conn.execute("PRAGMA table_info(model_routes)")}
                if "model_filename" in route_columns and "ai_model_filename" not in route_columns:
                    conn.execute("ALTER TABLE model_routes RENAME COLUMN model_filename TO ai_model_filename")

                registry_columns = {row["name"] for row in conn.execute("PRAGMA table_info(model_registry)")}
                if "model_name" in registry_columns and "ai_model_name" not in registry_columns:
                    conn.execute("ALTER TABLE model_registry RENAME COLUMN model_name TO ai_model_name")
                if "runtime" in registry_columns and "ai_runtime" not in registry_columns:
                    conn.execute("ALTER TABLE model_registry RENAME COLUMN runtime TO ai_runtime")
                if "filename" in registry_columns and "ai_model_filename" not in registry_columns:
                    conn.execute("ALTER TABLE model_registry RENAME COLUMN filename TO ai_model_filename")
                registry_columns = {row["name"] for row in conn.execute("PRAGMA table_info(model_registry)")}
                if "lifecycle_state" not in registry_columns:
                    conn.execute("ALTER TABLE model_registry ADD COLUMN lifecycle_state TEXT NOT NULL DEFAULT 'production'")

                mapping_columns = {row["name"] for row in conn.execute("PRAGMA table_info(field_mappings)")}
                if "model_id" in mapping_columns and "ai_model_id" not in mapping_columns:
                    conn.execute("ALTER TABLE field_mappings RENAME COLUMN model_id TO ai_model_id")
                mapping_columns = {row["name"] for row in conn.execute("PRAGMA table_info(field_mappings)")}
                if "source_data_type" not in mapping_columns:
                    conn.execute("ALTER TABLE field_mappings ADD COLUMN source_data_type TEXT NOT NULL DEFAULT 'image'")
                if "source_selector" not in mapping_columns:
                    conn.execute("ALTER TABLE field_mappings ADD COLUMN source_selector TEXT NOT NULL DEFAULT ''")
                if "target_data_type" not in mapping_columns:
                    conn.execute("ALTER TABLE field_mappings ADD COLUMN target_data_type TEXT NOT NULL DEFAULT 'text'")
                if "target_selector" not in mapping_columns:
                    conn.execute("ALTER TABLE field_mappings ADD COLUMN target_selector TEXT NOT NULL DEFAULT ''")

                # Ensure a default global_access rule exists
                conn.execute(
                    "INSERT OR IGNORE INTO access_control (key, value) VALUES ('global_access', 'true')"
                )
                conn.commit()

    # ── Platform Settings (admin-configurable runtime config) ─────────────────

    # Keys and their default values — used when no DB row exists yet
    _SETTING_DEFAULTS: dict[str, str] = {
        # LiteLLM / AI
        "exam.litellm_endpoint":  "",
        "exam.litellm_api_key":   "",
        "exam.litellm_model":     "gemma-4-31b-it_gemini",
        # OCR
        "exam.ocr_lang":          "eng+hin",
        "exam.tessdata_path":     "backend/tessdata",
        # WhatsApp alerts
        "alerts.whatsapp_enabled":  "false",
        "alerts.callmebot_phone":   "",
        "alerts.callmebot_apikey":  "",
        # General
        "platform.name":          "Unified Platform",
    }

    _SETTING_DESCRIPTIONS: dict[str, str] = {
        "exam.litellm_endpoint":    "LiteLLM / OpenAI-compatible endpoint URL for MCQ AI fallback",
        "exam.litellm_api_key":     "API key for the LiteLLM endpoint",
        "exam.litellm_model":       "Model name to pass to LiteLLM (e.g. gemma-4-31b-it_gemini)",
        "exam.ocr_lang":            "Tesseract OCR language codes, e.g. eng or eng+hin",
        "exam.tessdata_path":       "Path to .traineddata files (relative to project root)",
        "alerts.whatsapp_enabled":  "Enable WhatsApp admin alerts (true/false)",
        "alerts.callmebot_phone":   "Admin WhatsApp number in E.164 format (+91XXXXXXXXXX)",
        "alerts.callmebot_apikey":  "CallMeBot API key (get from callmebot.com)",
        "platform.name":            "Display name shown in admin dashboard",
    }

    def get_setting(self, key: str, default: str | None = None) -> str:
        """Read a single runtime setting from DB. Falls back to class default then param default."""
        with self.connect() as conn:
            row = conn.execute(
                "SELECT value FROM platform_settings WHERE key = ?", (key,)
            ).fetchone()
            if row:
                return str(row["value"])
        # Not in DB — return class default or param default
        return self._SETTING_DEFAULTS.get(key, default or "")

    def set_setting(self, key: str, value: str, description: str | None = None) -> None:
        """Upsert a runtime setting into the DB."""
        desc = description or self._SETTING_DESCRIPTIONS.get(key)
        now = datetime.now(timezone.utc).isoformat()
        with self._lock:
            with self.connect() as conn:
                conn.execute(
                    """
                    INSERT INTO platform_settings (key, value, description, updated_at)
                    VALUES (?, ?, ?, ?)
                    ON CONFLICT(key) DO UPDATE SET
                        value = excluded.value,
                        description = COALESCE(excluded.description, platform_settings.description),
                        updated_at = excluded.updated_at
                    """,
                    (key, value, desc, now),
                )
                conn.commit()

    def get_all_settings(self) -> list[dict]:
        """Return all settings rows for admin display, merging with defaults."""
        with self.connect() as conn:
            rows = {
                row["key"]: {"key": row["key"], "value": row["value"],
                             "description": row["description"], "updated_at": row["updated_at"]}
                for row in conn.execute("SELECT * FROM platform_settings ORDER BY key")
            }
        # Fill in any missing keys from defaults so admin sees all available settings
        result = []
        for key, default_val in self._SETTING_DEFAULTS.items():
            if key in rows:
                result.append(rows[key])
            else:
                result.append({
                    "key": key,
                    "value": default_val,
                    "description": self._SETTING_DESCRIPTIONS.get(key, ""),
                    "updated_at": None,
                })
        # Include any extra DB keys not in defaults
        for key, row in rows.items():
            if key not in self._SETTING_DEFAULTS:
                result.append(row)
        return result

    # ── API Keys ───────────────────────────────────────────────────────────────

    def insert_api_key(
        self, name: str, key_hash: str, expires_at: str | None
    ) -> int:
        """Insert API key and return row id."""

        with self._lock:
            with self.connect() as conn:
                now = datetime.now(timezone.utc).isoformat()
                cursor = conn.execute(
                    """
                    INSERT INTO api_keys (name, key_hash, enabled, created_at, expires_at, revoked_at)
                    VALUES (?, ?, 1, ?, ?, NULL)
                    """,
                    (name, key_hash, now, expires_at),
                )
                conn.commit()
                return int(cursor.lastrowid)

    def get_api_key_by_hash(self, key_hash: str) -> dict[str, Any] | None:
        """Fetch API key record by hash."""

        with self.connect() as conn:
            cursor = conn.execute(
                "SELECT * FROM api_keys WHERE key_hash = ?",
                (key_hash,),
            )
            row = cursor.fetchone()
            return dict(row) if row else None

    def revoke_api_key(self, key_hash: str) -> bool:
        """Disable API key hash."""

        with self._lock:
            with self.connect() as conn:
                now = datetime.now(timezone.utc).isoformat()
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
        with self._lock:
            with self.connect() as conn:
                now = datetime.now(timezone.utc).isoformat()
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

        with self._lock:
            with self.connect() as conn:
                now = datetime.now(timezone.utc).isoformat()
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
        with self.connect() as conn:
            return [
                dict(row)
                for row in conn.execute(
                    "SELECT id, name, enabled, all_domains, created_at, expires_at, revoked_at FROM api_keys ORDER BY id DESC"
                )
            ]

    def set_api_key_domain_scope(self, key_id: int, all_domains: bool, domains: list[str] | None = None) -> None:
        clean_domains = sorted({self._normalize_domain(d) for d in (domains or []) if self._normalize_domain(d)})
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
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT domain FROM api_key_allowed_domains WHERE key_id = ? ORDER BY domain ASC",
                (key_id,),
            )
            return [str(row["domain"]) for row in rows]

    def is_domain_allowed_for_key(self, key_id: int, domain: str | None) -> bool:
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
        now = datetime.now(timezone.utc).isoformat()
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

    # --- New Anti-Gravity Methods ---

    def get_model_route(self, domain: str) -> str | None:
        with self.connect() as conn:
            for candidate in self._domain_candidates(domain):
                row = conn.execute(
                    "SELECT ai_model_filename FROM model_routes WHERE domain = ?",
                    (candidate,),
                ).fetchone()
                if row:
                    return row["ai_model_filename"]
            return None

    def set_model_route(self, domain: str, ai_model_filename: str) -> None:
        clean_domain = self._normalize_domain(domain)
        if not clean_domain:
            return
        with self._lock:
            with self.connect() as conn:
                conn.execute(
                    "INSERT INTO model_routes (domain, ai_model_filename) VALUES (?, ?) ON CONFLICT(domain) DO UPDATE SET ai_model_filename=excluded.ai_model_filename",
                    (clean_domain, ai_model_filename)
                )
                conn.commit()

    def get_all_model_routes(self) -> list[dict[str, Any]]:
        with self.connect() as conn:
            return [dict(row) for row in conn.execute("SELECT * FROM model_routes")]

    def add_model_registry_entry(
        self,
        ai_model_name: str,
        version: str,
        task_type: str,
        ai_runtime: str,
        ai_model_filename: str,
        notes: str | None,
        status: str = "active",
        lifecycle_state: str = "candidate",
    ) -> int:
        with self._lock:
            with self.connect() as conn:
                now = datetime.now(timezone.utc).isoformat()
                cursor = conn.execute(
                    """
                    INSERT INTO model_registry (ai_model_name, version, task_type, ai_runtime, ai_model_filename, status, lifecycle_state, notes, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        ai_model_name,
                        version,
                        task_type,
                        ai_runtime,
                        ai_model_filename,
                        status,
                        lifecycle_state,
                        notes,
                        now,
                        now,
                    ),
                )
                conn.commit()
                return int(cursor.lastrowid)

    def get_model_registry(self) -> list[dict[str, Any]]:
        with self.connect() as conn:
            return [
                dict(row)
                for row in conn.execute(
                    "SELECT * FROM model_registry ORDER BY updated_at DESC, id DESC"
                )
            ]

    def get_model_registry_entry(self, model_id: int) -> dict[str, Any] | None:
        with self.connect() as conn:
            row = conn.execute(
                "SELECT * FROM model_registry WHERE id = ?",
                (model_id,),
            ).fetchone()
            return dict(row) if row else None

    def delete_model_registry_entry(self, model_id: int) -> None:
        with self._lock:
            with self.connect() as conn:
                conn.execute("DELETE FROM model_registry WHERE id = ?", (model_id,))
                conn.commit()

    def update_model_registry_entry(
        self,
        ai_model_id: int,
        ai_model_name: str,
        version: str,
        task_type: str,
        notes: str | None,
        lifecycle_state: str,
    ) -> None:
        with self._lock:
            with self.connect() as conn:
                now = datetime.now(timezone.utc).isoformat()
                conn.execute(
                    """
                    UPDATE model_registry
                    SET ai_model_name = ?, version = ?, task_type = ?, notes = ?, lifecycle_state = ?, updated_at = ?
                    WHERE id = ?
                    """,
                    (ai_model_name, version, task_type, notes, lifecycle_state, now, ai_model_id),
                )
                conn.commit()

    def set_field_mapping(
        self,
        domain: str,
        field_name: str,
        task_type: str,
        ai_model_id: int,
        source_data_type: str | None = None,
        source_selector: str | None = None,
        target_data_type: str | None = None,
        target_selector: str | None = None,
    ) -> None:
        clean_domain = self._normalize_domain(domain)
        if not clean_domain:
            return
        with self._lock:
            with self.connect() as conn:
                now = datetime.now(timezone.utc).isoformat()
                conn.execute(
                    """
                    INSERT INTO field_mappings (
                        domain, field_name, task_type, source_data_type, source_selector, target_data_type, target_selector, ai_model_id, created_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(domain, field_name, task_type) DO UPDATE SET
                        source_data_type = excluded.source_data_type,
                        source_selector = excluded.source_selector,
                        target_data_type = excluded.target_data_type,
                        target_selector = excluded.target_selector,
                        ai_model_id = excluded.ai_model_id,
                        created_at = excluded.created_at
                    """,
                    (
                        clean_domain,
                        field_name,
                        task_type,
                        source_data_type or task_type,
                        source_selector or "",
                        target_data_type or "text",
                        target_selector or "",
                        ai_model_id,
                        now,
                    ),
                )
                conn.commit()

    def remove_field_mapping(self, mapping_id: int) -> None:
        with self._lock:
            with self.connect() as conn:
                conn.execute("DELETE FROM field_mappings WHERE id = ?", (mapping_id,))
                conn.commit()

    def update_field_mapping(
        self,
        mapping_id: int,
        domain: str,
        field_name: str,
        task_type: str,
        source_data_type: str,
        source_selector: str,
        target_data_type: str,
        target_selector: str,
        ai_model_id: int,
    ) -> None:
        clean_domain = self._normalize_domain(domain)
        if not clean_domain:
            return
        with self._lock:
            with self.connect() as conn:
                now = datetime.now(timezone.utc).isoformat()
                conn.execute(
                    """
                    UPDATE field_mappings
                    SET domain = ?, field_name = ?, task_type = ?,
                        source_data_type = ?, source_selector = ?, target_data_type = ?, target_selector = ?,
                        ai_model_id = ?, created_at = ?
                    WHERE id = ?
                    """,
                    (
                        clean_domain,
                        field_name,
                        task_type,
                        source_data_type,
                        source_selector,
                        target_data_type,
                        target_selector,
                        ai_model_id,
                        now,
                        mapping_id,
                    ),
                )
                conn.commit()

    def rename_domain_mappings(self, old_domain: str, new_domain: str) -> int:
        clean_old = self._normalize_domain(old_domain)
        clean_new = self._normalize_domain(new_domain)
        if not clean_old or not clean_new:
            return 0
        with self._lock:
            with self.connect() as conn:
                conflict = conn.execute(
                    """
                    SELECT 1
                    FROM field_mappings src
                    JOIN field_mappings dst
                      ON dst.domain = ?
                     AND dst.field_name = src.field_name
                     AND dst.task_type = src.task_type
                    WHERE src.domain = ?
                    LIMIT 1
                    """,
                    (clean_new, clean_old),
                ).fetchone()
                if conflict:
                    raise ValueError("domain rename would create duplicate mapping keys")
                result = conn.execute(
                    "UPDATE field_mappings SET domain = ? WHERE domain = ?",
                    (clean_new, clean_old),
                )
                conn.commit()
                return int(result.rowcount or 0)

    def assign_model_to_domain(self, domain: str, ai_model_id: int) -> int:
        clean_domain = self._normalize_domain(domain)
        if not clean_domain:
            return 0
        with self._lock:
            with self.connect() as conn:
                model_row = conn.execute(
                    "SELECT task_type FROM model_registry WHERE id = ?",
                    (ai_model_id,),
                ).fetchone()
                if not model_row:
                    return 0
                model_task = str(model_row["task_type"])
                # Preferred path: only update mappings with matching task type.
                result = conn.execute(
                    """
                    UPDATE field_mappings
                    SET ai_model_id = ?
                    WHERE domain = ? AND task_type = ?
                    """,
                    (ai_model_id, clean_domain, model_task),
                )
                updated = int(result.rowcount or 0)
                if updated > 0:
                    conn.commit()
                    return updated

                # Backward-compat path for older datasets where task_type can be stale.
                # First try source_data_type match.
                result = conn.execute(
                    """
                    UPDATE field_mappings
                    SET ai_model_id = ?
                    WHERE domain = ? AND source_data_type = ?
                    """,
                    (ai_model_id, clean_domain, model_task),
                )
                updated = int(result.rowcount or 0)
                if updated > 0:
                    conn.commit()
                    return updated

                # Final fallback: if domain has mappings, apply model across that domain.
                exists = conn.execute(
                    "SELECT 1 FROM field_mappings WHERE domain = ? LIMIT 1",
                    (clean_domain,),
                ).fetchone()
                if not exists:
                    conn.commit()
                    return 0
                result = conn.execute(
                    """
                    UPDATE field_mappings
                    SET ai_model_id = ?
                    WHERE domain = ?
                    """,
                    (ai_model_id, clean_domain),
                )
                conn.commit()
                return int(result.rowcount or 0)

    def get_all_field_mappings(self) -> list[dict[str, Any]]:
        with self.connect() as conn:
            rows = conn.execute(
                """
                SELECT fm.id, fm.domain, fm.field_name, fm.task_type,
                       fm.source_data_type, fm.source_selector, fm.target_data_type, fm.target_selector,
                       fm.ai_model_id, fm.created_at,
                       mr.ai_model_name, mr.version, mr.ai_runtime, mr.ai_model_filename, mr.lifecycle_state
                FROM field_mappings fm
                LEFT JOIN model_registry mr ON mr.id = fm.ai_model_id
                ORDER BY fm.created_at DESC, fm.id DESC
                """
            )
            return [dict(row) for row in rows]

    def get_domain_field_mappings(self, domain: str) -> dict[str, dict[str, str]]:
        with self.connect() as conn:
            result: dict[str, dict[str, str]] = {}
            for candidate in self._domain_candidates(domain):
                rows = conn.execute(
                    """
                    SELECT fm.field_name, fm.task_type, fm.source_data_type, fm.source_selector, fm.target_data_type, fm.target_selector,
                           mr.ai_runtime, mr.ai_model_filename, mr.lifecycle_state
                    FROM field_mappings fm
                    JOIN model_registry mr ON mr.id = fm.ai_model_id
                    WHERE fm.domain = ? AND mr.status = 'active'
                    """,
                    (candidate,),
                )
                for row in rows:
                    result[row["field_name"]] = {
                        "task_type": row["task_type"],
                        "source_data_type": row["source_data_type"],
                        "source_selector": row["source_selector"],
                        "target_data_type": row["target_data_type"],
                        "target_selector": row["target_selector"],
                        "runtime": row["ai_runtime"],
                        "model_filename": row["ai_model_filename"],
                        "lifecycle_state": row["lifecycle_state"],
                    }
                if result:
                    return result
            return result

    def get_all_domain_field_mappings(self) -> dict[str, list[dict[str, Any]]]:
        """Return approved field mappings for all domains for extension sync."""
        with self.connect() as conn:
            rows = conn.execute(
                """
                SELECT fm.domain, fm.field_name, fm.task_type,
                       fm.source_data_type, fm.source_selector, fm.target_data_type, fm.target_selector,
                       mr.ai_model_name, mr.version, mr.ai_runtime, mr.ai_model_filename, mr.lifecycle_state
                FROM field_mappings fm
                JOIN model_registry mr ON mr.id = fm.ai_model_id
                WHERE mr.status = 'active'
                ORDER BY fm.domain ASC, fm.id ASC
                """
            )
            grouped: dict[str, list[dict[str, Any]]] = {}
            for row in rows:
                domain = row["domain"]
                grouped.setdefault(domain, []).append(
                    {
                        "field_name": row["field_name"],
                        "task_type": row["task_type"],
                        "source_data_type": row["source_data_type"],
                        "source_selector": row["source_selector"],
                        "target_data_type": row["target_data_type"],
                        "target_selector": row["target_selector"],
                        "ai_model_name": row["ai_model_name"],
                        "version": row["version"],
                        "ai_runtime": row["ai_runtime"],
                        "ai_model_filename": row["ai_model_filename"],
                        "lifecycle_state": row["lifecycle_state"],
                    }
                )
            return grouped

    def propose_field_mapping(
        self,
        domain: str,
        task_type: str,
        source_data_type: str,
        source_selector: str,
        target_data_type: str,
        target_selector: str,
        proposed_field_name: str,
        reported_by: int,
    ) -> None:
        clean_domain = self._normalize_domain(domain)
        if not clean_domain:
            return
        with self._lock:
            with self.connect() as conn:
                now = datetime.now(timezone.utc).isoformat()
                exists = conn.execute(
                    """
                    SELECT id FROM field_mapping_proposals
                    WHERE domain = ? AND task_type = ? AND source_selector = ? AND target_selector = ? AND status = 'pending'
                    """,
                    (clean_domain, task_type, source_selector, target_selector),
                ).fetchone()
                if exists:
                    return
                approved_exists = conn.execute(
                    """
                    SELECT id FROM field_mappings
                    WHERE domain = ? AND task_type = ? AND source_selector = ? AND target_selector = ?
                    LIMIT 1
                    """,
                    (clean_domain, task_type, source_selector, target_selector),
                ).fetchone()
                if approved_exists:
                    return
                conn.execute(
                    """
                    INSERT INTO field_mapping_proposals (
                        domain, task_type, source_data_type, source_selector, target_data_type, target_selector,
                        proposed_field_name, reported_by, status, created_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
                    """,
                    (
                        clean_domain,
                        task_type,
                        source_data_type,
                        source_selector,
                        target_data_type,
                        target_selector,
                        proposed_field_name,
                        reported_by,
                        now,
                    ),
                )
                conn.commit()

    def get_pending_field_mapping_proposals(self) -> list[dict[str, Any]]:
        with self.connect() as conn:
            rows = conn.execute(
                """
                SELECT * FROM field_mapping_proposals
                WHERE status = 'pending'
                ORDER BY id DESC
                """
            )
            return [dict(row) for row in rows]

    def mark_field_mapping_proposal_status(self, proposal_id: int, status: str) -> None:
        with self._lock:
            with self.connect() as conn:
                conn.execute(
                    "UPDATE field_mapping_proposals SET status = ? WHERE id = ?",
                    (status, proposal_id),
                )
                conn.commit()

    def get_field_mapped_model(
        self,
        domain: str | None,
        field_name: str | None,
        task_type: str,
    ) -> dict[str, Any] | None:
        domain_candidates = self._domain_candidates(domain)
        if not domain_candidates:
            return None
        with self.connect() as conn:
            for candidate in domain_candidates:
                if field_name:
                    row = conn.execute(
                        """
                        SELECT mr.ai_runtime, mr.ai_model_filename, mr.status, mr.lifecycle_state
                        FROM field_mappings fm
                        JOIN model_registry mr ON mr.id = fm.ai_model_id
                        WHERE fm.domain = ? AND fm.field_name = ? AND fm.task_type = ?
                        ORDER BY CASE mr.lifecycle_state
                            WHEN 'production' THEN 0
                            WHEN 'staging' THEN 1
                            WHEN 'candidate' THEN 2
                            ELSE 3
                        END
                        LIMIT 1
                        """,
                        (candidate, field_name, task_type),
                    ).fetchone()
                    if row:
                        data = dict(row)
                        if data.get("status") == "active":
                            return data
                # Fallback to domain+task default mapping to avoid hard field coupling.
                row = conn.execute(
                    """
                    SELECT mr.ai_runtime, mr.ai_model_filename, mr.status, mr.lifecycle_state
                    FROM field_mappings fm
                    JOIN model_registry mr ON mr.id = fm.ai_model_id
                    WHERE fm.domain = ? AND fm.task_type = ?
                    ORDER BY CASE
                        WHEN fm.field_name = ? THEN 0
                        WHEN fm.field_name = ? THEN 1
                        ELSE 2
                    END,
                    CASE mr.lifecycle_state
                        WHEN 'production' THEN 0
                        WHEN 'staging' THEN 1
                        WHEN 'candidate' THEN 2
                        ELSE 3
                    END
                    LIMIT 1
                    """,
                    (candidate, task_type, f"{task_type}_default", "default"),
                ).fetchone()
                if row:
                    data = dict(row)
                    if data.get("status") == "active":
                        return data
            return None

    def set_lifecycle_state(
        self,
        ai_model_id: int,
        to_state: str,
        changed_by: int | None,
        reason: str | None = None,
    ) -> None:
        with self._lock:
            with self.connect() as conn:
                row = conn.execute(
                    "SELECT lifecycle_state FROM model_registry WHERE id = ?",
                    (ai_model_id,),
                ).fetchone()
                if not row:
                    return
                from_state = row["lifecycle_state"]
                now = datetime.now(timezone.utc).isoformat()
                conn.execute(
                    "UPDATE model_registry SET lifecycle_state = ?, updated_at = ? WHERE id = ?",
                    (to_state, now, ai_model_id),
                )
                conn.execute(
                    """
                    INSERT INTO model_lifecycle_events (ai_model_id, from_state, to_state, reason, changed_by, created_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (ai_model_id, from_state, to_state, reason, changed_by, now),
                )
                conn.commit()

    def get_latest_model_by_state(self, task_type: str, lifecycle_state: str, exclude_id: int | None = None) -> dict[str, Any] | None:
        with self.connect() as conn:
            query = """
                SELECT * FROM model_registry
                WHERE task_type = ? AND lifecycle_state = ? AND status = 'active'
            """
            params: list[Any] = [task_type, lifecycle_state]
            if exclude_id is not None:
                query += " AND id != ?"
                params.append(exclude_id)
            query += " ORDER BY updated_at DESC, id DESC LIMIT 1"
            row = conn.execute(query, tuple(params)).fetchone()
            return dict(row) if row else None

    def insert_retrain_sample(
        self,
        domain: str,
        image_path: str,
        reported_by: int,
        task_type: str = "image",
        field_name: str | None = None,
    ) -> int:
        with self._lock:
            with self.connect() as conn:
                now = datetime.now(timezone.utc).isoformat()
                cursor = conn.execute(
                    """
                    INSERT INTO retrain_samples (domain, image_path, task_type, field_name, reported_by, status, created_at)
                    VALUES (?, ?, ?, ?, ?, 'queued', ?)
                    """,
                    (domain, image_path, task_type, field_name, reported_by, now),
                )
                conn.commit()
                return int(cursor.lastrowid)

    def get_retrain_samples(self, status: str, limit: int = 100) -> list[dict[str, Any]]:
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT * FROM retrain_samples WHERE status = ? ORDER BY id ASC LIMIT ?",
                (status, limit),
            )
            return [dict(row) for row in rows]

    def label_retrain_sample(self, sample_id: int, label_text: str, labeled_by: int | None) -> None:
        with self._lock:
            with self.connect() as conn:
                now = datetime.now(timezone.utc).isoformat()
                conn.execute(
                    """
                    UPDATE retrain_samples
                    SET status = 'labeled', label_text = ?, labeled_by = ?, labeled_at = ?
                    WHERE id = ?
                    """,
                    (label_text, labeled_by, now, sample_id),
                )
                conn.commit()

    def reject_retrain_sample(self, sample_id: int, labeled_by: int | None) -> None:
        with self._lock:
            with self.connect() as conn:
                now = datetime.now(timezone.utc).isoformat()
                conn.execute(
                    """
                    UPDATE retrain_samples
                    SET status = 'rejected', labeled_by = ?, labeled_at = ?
                    WHERE id = ?
                    """,
                    (labeled_by, now, sample_id),
                )
                conn.commit()

    def get_retrain_sample_counts(self) -> dict[str, int]:
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT status, COUNT(*) AS c FROM retrain_samples GROUP BY status"
            )
            counts = {"queued": 0, "labeled": 0, "rejected": 0, "consumed": 0}
            for row in rows:
                counts[row["status"]] = int(row["c"])
            return counts

    def upsert_failed_payload_label(
        self,
        filename: str,
        domain: str,
        ai_guess: str | None,
        corrected_text: str,
    ) -> None:
        with self._lock:
            with self.connect() as conn:
                now = datetime.now(timezone.utc).isoformat()
                conn.execute(
                    """
                    INSERT INTO failed_payload_labels (filename, domain, ai_guess, corrected_text, updated_at)
                    VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT(filename) DO UPDATE SET
                        domain = excluded.domain,
                        ai_guess = excluded.ai_guess,
                        corrected_text = excluded.corrected_text,
                        updated_at = excluded.updated_at
                    """,
                    (filename, domain, ai_guess, corrected_text, now),
                )
                conn.commit()

    def get_failed_payload_labels(self) -> dict[str, dict[str, Any]]:
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT filename, domain, ai_guess, corrected_text, updated_at FROM failed_payload_labels ORDER BY updated_at DESC"
            )
            return {
                row["filename"]: {
                    "domain": row["domain"],
                    "ai_guess": row["ai_guess"],
                    "corrected_text": row["corrected_text"],
                    "updated_at": row["updated_at"],
                }
                for row in rows
            }

    def create_retrain_job(
        self,
        requested_by: int | None,
        min_samples: int,
        notes: str | None,
        scheduled_for: str | None = None,
    ) -> int:
        with self._lock:
            with self.connect() as conn:
                now = datetime.now(timezone.utc).isoformat()
                when = scheduled_for or now
                cursor = conn.execute(
                    """
                    INSERT INTO retrain_jobs (status, scheduled_for, requested_by, min_samples, notes)
                    VALUES ('queued', ?, ?, ?, ?)
                    """,
                    (when, requested_by, min_samples, notes),
                )
                conn.commit()
                return int(cursor.lastrowid)

    def get_due_retrain_jobs(self, now_iso: str) -> list[dict[str, Any]]:
        with self.connect() as conn:
            rows = conn.execute(
                """
                SELECT * FROM retrain_jobs
                WHERE status = 'queued' AND scheduled_for <= ?
                ORDER BY id ASC
                """,
                (now_iso,),
            )
            return [dict(row) for row in rows]

    def mark_retrain_job_running(self, job_id: int) -> None:
        with self._lock:
            with self.connect() as conn:
                now = datetime.now(timezone.utc).isoformat()
                conn.execute(
                    "UPDATE retrain_jobs SET status='running', started_at=? WHERE id=?",
                    (now, job_id),
                )
                conn.commit()

    def mark_retrain_job_done(self, job_id: int, produced_ai_model_id: int | None, total_samples: int) -> None:
        with self._lock:
            with self.connect() as conn:
                now = datetime.now(timezone.utc).isoformat()
                conn.execute(
                    """
                    UPDATE retrain_jobs
                    SET status='completed', finished_at=?, produced_ai_model_id=?, total_samples=?
                    WHERE id=?
                    """,
                    (now, produced_ai_model_id, total_samples, job_id),
                )
                conn.commit()

    def mark_retrain_job_failed(self, job_id: int, error_message: str) -> None:
        with self._lock:
            with self.connect() as conn:
                now = datetime.now(timezone.utc).isoformat()
                conn.execute(
                    """
                    UPDATE retrain_jobs
                    SET status='failed', finished_at=?, error_message=?
                    WHERE id=?
                    """,
                    (now, error_message[:500], job_id),
                )
                conn.commit()

    def get_retrain_jobs(self, limit: int = 50) -> list[dict[str, Any]]:
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT * FROM retrain_jobs ORDER BY id DESC LIMIT ?",
                (limit,),
            )
            return [dict(row) for row in rows]

    def claim_labeled_samples(self, job_id: int, limit: int) -> list[dict[str, Any]]:
        with self._lock:
            with self.connect() as conn:
                rows = conn.execute(
                    """
                    SELECT * FROM retrain_samples
                    WHERE status = 'labeled' AND consumed_by_job_id IS NULL
                    ORDER BY id ASC
                    LIMIT ?
                    """,
                    (limit,),
                ).fetchall()
                sample_ids = [int(row["id"]) for row in rows]
                if sample_ids:
                    conn.executemany(
                        "UPDATE retrain_samples SET consumed_by_job_id = ?, status = 'consumed' WHERE id = ?",
                        [(job_id, sample_id) for sample_id in sample_ids],
                    )
                    conn.commit()
                return [dict(row) for row in rows]

    def release_job_claims(self, job_id: int) -> None:
        with self._lock:
            with self.connect() as conn:
                conn.execute(
                    """
                    UPDATE retrain_samples
                    SET consumed_by_job_id = NULL, status = 'labeled'
                    WHERE consumed_by_job_id = ?
                    """,
                    (job_id,),
                )
                conn.commit()

    def get_global_access(self) -> bool:
        with self.connect() as conn:
            cursor = conn.execute("SELECT value FROM access_control WHERE key = 'global_access'")
            row = cursor.fetchone()
            return row["value"] == "true" if row else True

    def set_global_access(self, enabled: bool) -> None:
        with self._lock:
            with self.connect() as conn:
                val = "true" if enabled else "false"
                conn.execute(
                    "INSERT INTO access_control (key, value) VALUES ('global_access', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                    (val,)
                )
                conn.commit()

    def get_allowed_domains(self) -> list[str]:
        with self.connect() as conn:
            normalized = {
                self._normalize_domain(row["domain"])
                for row in conn.execute("SELECT domain FROM allowed_domains")
            }
            return sorted([d for d in normalized if d])

    def is_domain_allowed(self, domain: str | None) -> bool:
        candidate_set = set(self._domain_candidates(domain))
        if not candidate_set:
            return False
        allowed = set(self.get_allowed_domains())
        return bool(candidate_set & allowed)

    def add_allowed_domain(self, domain: str) -> None:
        clean_domain = self._normalize_domain(domain)
        if not clean_domain:
            return
        with self._lock:
            with self.connect() as conn:
                conn.execute("INSERT OR IGNORE INTO allowed_domains (domain) VALUES (?)", (clean_domain,))
                conn.commit()

    def remove_allowed_domain(self, domain: str) -> None:
        clean_domain = self._normalize_domain(domain)
        if not clean_domain:
            return
        with self._lock:
            with self.connect() as conn:
                conn.execute("DELETE FROM allowed_domains WHERE domain = ?", (clean_domain,))
                conn.commit()

    def export_master_setup(self) -> dict[str, Any]:
        """Export current admin setup for one-click migration."""
        return {
            "global_access": self.get_global_access(),
            "allowed_domains": self.get_allowed_domains(),
            "model_routes": self.get_all_model_routes(),
            "model_registry": self.get_model_registry(),
            "field_mappings": self.get_all_field_mappings(),
            "locators": self.get_approved_locators(),
            "exported_at": datetime.now(timezone.utc).isoformat(),
        }

    def import_master_setup(self, payload: dict[str, Any]) -> None:
        """Import setup snapshot (metadata only; model files must exist on disk)."""
        with self._lock:
            with self.connect() as conn:
                now = datetime.now(timezone.utc).isoformat()
                global_access = bool(payload.get("global_access", True))
                conn.execute(
                    "INSERT INTO access_control (key, value) VALUES ('global_access', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                    ("true" if global_access else "false",),
                )

                conn.execute("DELETE FROM allowed_domains")
                for domain in payload.get("allowed_domains", []) or []:
                    d = self._normalize_domain(domain)
                    if d:
                        conn.execute("INSERT OR IGNORE INTO allowed_domains (domain) VALUES (?)", (d,))

                model_id_by_filename: dict[str, int] = {}
                for item in payload.get("model_registry", []) or []:
                    filename = str(item.get("ai_model_filename") or "").strip()
                    if not filename:
                        continue
                    ai_model_name = str(item.get("ai_model_name") or "imported-model").strip() or "imported-model"
                    version = str(item.get("version") or "v1").strip() or "v1"
                    task_type = str(item.get("task_type") or "image").strip() or "image"
                    ai_runtime = str(item.get("ai_runtime") or "onnx").strip() or "onnx"
                    status = str(item.get("status") or "active").strip() or "active"
                    lifecycle_state = str(item.get("lifecycle_state") or "candidate").strip() or "candidate"
                    notes = item.get("notes")
                    conn.execute(
                        """
                        INSERT INTO model_registry (ai_model_name, version, task_type, ai_runtime, ai_model_filename, status, lifecycle_state, notes, created_at, updated_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        ON CONFLICT(ai_model_filename) DO UPDATE SET
                            ai_model_name = excluded.ai_model_name,
                            version = excluded.version,
                            task_type = excluded.task_type,
                            ai_runtime = excluded.ai_runtime,
                            status = excluded.status,
                            lifecycle_state = excluded.lifecycle_state,
                            notes = excluded.notes,
                            updated_at = excluded.updated_at
                        """,
                        (ai_model_name, version, task_type, ai_runtime, filename, status, lifecycle_state, notes, now, now),
                    )
                    row = conn.execute(
                        "SELECT id FROM model_registry WHERE ai_model_filename = ?",
                        (filename,),
                    ).fetchone()
                    if row:
                        model_id_by_filename[filename] = int(row["id"])

                conn.execute("DELETE FROM model_routes")
                for route in payload.get("model_routes", []) or []:
                    domain = self._normalize_domain(route.get("domain"))
                    filename = str(route.get("ai_model_filename") or "").strip()
                    if domain and filename:
                        conn.execute(
                            "INSERT OR REPLACE INTO model_routes (domain, ai_model_filename) VALUES (?, ?)",
                            (domain, filename),
                        )

                conn.execute("DELETE FROM field_mappings")
                for fm in payload.get("field_mappings", []) or []:
                    domain = self._normalize_domain(fm.get("domain"))
                    field_name = str(fm.get("field_name") or "").strip()
                    task_type = str(fm.get("task_type") or "image").strip() or "image"
                    source_data_type = str(fm.get("source_data_type") or task_type).strip() or task_type
                    source_selector = str(fm.get("source_selector") or "").strip()
                    target_data_type = str(fm.get("target_data_type") or "text_input").strip() or "text_input"
                    target_selector = str(fm.get("target_selector") or "").strip()
                    filename = str(fm.get("ai_model_filename") or "").strip()
                    if not (domain and field_name and filename):
                        continue
                    ai_model_id = model_id_by_filename.get(filename)
                    if not ai_model_id:
                        row = conn.execute("SELECT id FROM model_registry WHERE ai_model_filename = ?", (filename,)).fetchone()
                        if not row:
                            continue
                        ai_model_id = int(row["id"])
                    conn.execute(
                        """
                        INSERT INTO field_mappings (domain, field_name, task_type, source_data_type, source_selector, target_data_type, target_selector, ai_model_id, created_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (domain, field_name, task_type, source_data_type, source_selector, target_data_type, target_selector, ai_model_id, now),
                    )

                conn.execute("DELETE FROM locators")
                locators = payload.get("locators", {}) or {}
                for domain, row in locators.items():
                    d = self._normalize_domain(domain)
                    img = str((row or {}).get("img") or "").strip()
                    inp = str((row or {}).get("input") or "").strip()
                    if d and img and inp:
                        conn.execute(
                            "INSERT INTO locators (domain, image_selector, input_selector, status, created_at) VALUES (?, ?, ?, 'approved', ?)",
                            (d, img, inp, now),
                        )

                conn.commit()

    def insert_active_learning(self, domain: str, image_path: str, reported_by: int) -> None:
        with self._lock:
            with self.connect() as conn:
                now = datetime.now(timezone.utc).isoformat()
                conn.execute(
                    "INSERT INTO active_learning (domain, image_path, reported_by, created_at) VALUES (?, ?, ?, ?)",
                    (domain, image_path, reported_by, now)
                )
                conn.commit()

    def get_active_learning_samples(self, limit: int = 50) -> list[dict[str, Any]]:
        with self.connect() as conn:
            return [dict(row) for row in conn.execute("SELECT * FROM active_learning ORDER BY id DESC LIMIT ?", (limit,))]

    # --- Locator Management Methods ---

    def propose_locator(self, domain: str, img: str, inp: str) -> None:
        clean_domain = self._normalize_domain(domain)
        if not clean_domain:
            return
        with self._lock, self.connect() as conn:
            now = datetime.now(timezone.utc).isoformat()
            # If the exact proposal already exists and is pending, ignore
            exists = conn.execute("SELECT id FROM locators WHERE domain=? AND image_selector=? AND input_selector=? AND status='pending'", (clean_domain, img, inp)).fetchone()
            if not exists:
                conn.execute("INSERT INTO locators (domain, image_selector, input_selector, created_at) VALUES (?, ?, ?, ?)", (clean_domain, img, inp, now))
                conn.commit()

    def get_pending_locators(self) -> list[dict[str, Any]]:
        with self.connect() as conn:
            return [dict(row) for row in conn.execute("SELECT * FROM locators WHERE status='pending' ORDER BY id DESC")]

    def get_approved_locators(self) -> dict[str, dict[str, str]]:
        with self.connect() as conn:
            rows = conn.execute("SELECT domain, image_selector, input_selector FROM locators WHERE status='approved'")
            return {row["domain"]: {"img": row["image_selector"], "input": row["input_selector"]} for row in rows}

    def approve_locator(self, locator_id: int) -> None:
        with self._lock, self.connect() as conn:
            # First get the domain of this locator
            row = conn.execute("SELECT domain FROM locators WHERE id=?", (locator_id,)).fetchone()
            if row:
                domain = row["domain"]
                # Reject any currently approved locators for this domain
                conn.execute("UPDATE locators SET status='rejected' WHERE domain=? AND status='approved'", (domain,))
                # Approve the new one
                conn.execute("UPDATE locators SET status='approved' WHERE id=?", (locator_id,))
                conn.commit()

    def reject_locator(self, locator_id: int) -> None:
        with self._lock, self.connect() as conn:
            conn.execute("UPDATE locators SET status='rejected' WHERE id=?", (locator_id,))
            conn.commit()
