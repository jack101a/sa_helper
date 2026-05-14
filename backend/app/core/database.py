"""SQLite database access layer — Facade Pattern."""

from __future__ import annotations

import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator
from urllib.parse import urlsplit

from app.core.config import Settings
from app.core.repositories.api_keys import APIKeyRepository
from app.core.repositories.models import ModelRepository
from app.core.repositories.autofill import AutofillRepository
from app.core.repositories.exam import ExamRepository
from app.core.repositories.exam_attempts import ExamAttemptsRepository
from app.core.repositories.exam_learned import ExamLearnedRepository
from app.core.repositories.training import TrainingRepository
from app.core.repositories.settings import SettingsRepository
from app.core.repositories.automation_methods import AutomationMethodRepository


class Database:
    """Thread-safe SQLite wrapper acting as a Facade for domain repositories."""

    def __init__(self, settings: Settings) -> None:
        self._path = Path(settings.storage.sqlite_path)
        self._lock = threading.Lock()
        self._path.parent.mkdir(parents=True, exist_ok=True)

        # Initialize repositories
        self.api_keys = APIKeyRepository(self)
        self.models = ModelRepository(self)
        self.autofill = AutofillRepository(self)
        self.exam = ExamRepository(self)
        self.exam_attempts = ExamAttemptsRepository(self)
        self.exam_learned = ExamLearnedRepository(self)
        self.training = TrainingRepository(self)
        self.settings = SettingsRepository(self)
        self.automation_methods = AutomationMethodRepository(self)

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
        """
        Yield a sqlite3 connection with row_factory set.

        WAL mode is enabled on each connection so concurrent readers never
        block a writer. Repositories are responsible for calling
        ``conn.commit()`` after writes; reads need no commit.
        """
        connection = sqlite3.connect(self._path, check_same_thread=False)
        connection.row_factory = sqlite3.Row
        # Enable WAL journal mode for better concurrency
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("PRAGMA synchronous=NORMAL")
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

                    CREATE TABLE IF NOT EXISTS autofill_rule_proposals (
                        id               INTEGER PRIMARY KEY AUTOINCREMENT,
                        idempotency_key  TEXT UNIQUE,
                        device_id        TEXT,
                        api_key_id       INTEGER,
                        status           TEXT NOT NULL DEFAULT 'pending',
                        reviewed_by      TEXT,
                        reviewed_at      TEXT,
                        submitted_at     TEXT,
                        rule_json        TEXT NOT NULL,
                        approved_rule_id TEXT,
                        created_at       TEXT NOT NULL
                    );

                    CREATE TABLE IF NOT EXISTS exam_attempts (
                        id               INTEGER PRIMARY KEY AUTOINCREMENT,
                        question_hash    TEXT NOT NULL,
                        selected_option  INTEGER NOT NULL,
                        was_correct      INTEGER NOT NULL,
                        method           TEXT,
                        processing_ms    INTEGER DEFAULT 0,
                        domain           TEXT,
                        question_num     INTEGER,
                        created_at       TEXT NOT NULL
                    );

                    CREATE TABLE IF NOT EXISTS exam_learned (
                        id               INTEGER PRIMARY KEY AUTOINCREMENT,
                        question_hash    TEXT NOT NULL UNIQUE,
                        question_phash   TEXT NOT NULL DEFAULT '',
                        question_text    TEXT DEFAULT '',
                        option_1         TEXT DEFAULT '',
                        option_2         TEXT DEFAULT '',
                        option_3         TEXT DEFAULT '',
                        option_4         TEXT DEFAULT '',
                        correct_option   INTEGER NOT NULL,
                        confidence       REAL NOT NULL DEFAULT 0.8,
                        seen_count       INTEGER NOT NULL DEFAULT 1,
                        first_seen       TEXT NOT NULL,
                        last_seen        TEXT NOT NULL,
                        source           TEXT NOT NULL DEFAULT 'exam_feedback',
                        learning_mode    TEXT NOT NULL DEFAULT 'hash_based',
                        ocr_quality      TEXT NOT NULL DEFAULT 'unverified',
                        ocr_preview_unreliable INTEGER NOT NULL DEFAULT 1,
                        verified_count   INTEGER NOT NULL DEFAULT 0,
                        wrong_count      INTEGER NOT NULL DEFAULT 0,
                        last_verified_at TEXT,
                        status           TEXT NOT NULL DEFAULT 'training'
                    );

                    CREATE TABLE IF NOT EXISTS automation_methods (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        name TEXT NOT NULL,
                        description TEXT NOT NULL DEFAULT '',
                        method_type TEXT NOT NULL DEFAULT 'stall-flow',
                        enabled INTEGER NOT NULL DEFAULT 1,
                        active INTEGER NOT NULL DEFAULT 0,
                        payload_json TEXT NOT NULL,
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL
                    );
                    """
                )
                # ── Column migrations (idempotent) ─────────────────────────
                usage_columns = {row["name"] for row in conn.execute("PRAGMA table_info(usage_events)")}
                if "model_used" not in usage_columns:
                    conn.execute("ALTER TABLE usage_events ADD COLUMN model_used TEXT")
                if "domain" not in usage_columns:
                    conn.execute("ALTER TABLE usage_events ADD COLUMN domain TEXT")
                if "ip" not in usage_columns:
                    conn.execute("ALTER TABLE usage_events ADD COLUMN ip TEXT")

                key_columns = {row["name"] for row in conn.execute("PRAGMA table_info(api_keys)")}
                if "all_domains" not in key_columns:
                    conn.execute("ALTER TABLE api_keys ADD COLUMN all_domains INTEGER NOT NULL DEFAULT 1")
                if "key_type" not in key_columns:
                    conn.execute("ALTER TABLE api_keys ADD COLUMN key_type TEXT NOT NULL DEFAULT 'user'")
                if "plan_name" not in key_columns:
                    conn.execute("ALTER TABLE api_keys ADD COLUMN plan_name TEXT NOT NULL DEFAULT 'Standard'")
                if "mobile" not in key_columns:
                    conn.execute("ALTER TABLE api_keys ADD COLUMN mobile TEXT NOT NULL DEFAULT ''")
                if "telegram_id" not in key_columns:
                    conn.execute("ALTER TABLE api_keys ADD COLUMN telegram_id TEXT NOT NULL DEFAULT ''")
                if "services_json" not in key_columns:
                    conn.execute("ALTER TABLE api_keys ADD COLUMN services_json TEXT NOT NULL DEFAULT '{\"autofill\":true,\"captcha\":true,\"stall\":true,\"solver\":true,\"custom\":false}'")

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
                # Re-read after possible renames
                registry_columns = {row["name"] for row in conn.execute("PRAGMA table_info(model_registry)")}
                if "lifecycle_state" not in registry_columns:
                    conn.execute("ALTER TABLE model_registry ADD COLUMN lifecycle_state TEXT NOT NULL DEFAULT 'production'")

                mapping_columns = {row["name"] for row in conn.execute("PRAGMA table_info(field_mappings)")}
                if "model_id" in mapping_columns and "ai_model_id" not in mapping_columns:
                    conn.execute("ALTER TABLE field_mappings RENAME COLUMN model_id TO ai_model_id")
                # Re-read after possible rename
                mapping_columns = {row["name"] for row in conn.execute("PRAGMA table_info(field_mappings)")}
                if "source_data_type" not in mapping_columns:
                    conn.execute("ALTER TABLE field_mappings ADD COLUMN source_data_type TEXT NOT NULL DEFAULT 'image'")
                if "source_selector" not in mapping_columns:
                    conn.execute("ALTER TABLE field_mappings ADD COLUMN source_selector TEXT NOT NULL DEFAULT ''")
                if "target_data_type" not in mapping_columns:
                    conn.execute("ALTER TABLE field_mappings ADD COLUMN target_data_type TEXT NOT NULL DEFAULT 'text'")
                if "target_selector" not in mapping_columns:
                    conn.execute("ALTER TABLE field_mappings ADD COLUMN target_selector TEXT NOT NULL DEFAULT ''")

                learned_columns = {row["name"] for row in conn.execute("PRAGMA table_info(exam_learned)")}
                if "question_phash" not in learned_columns:
                    conn.execute("ALTER TABLE exam_learned ADD COLUMN question_phash TEXT NOT NULL DEFAULT ''")
                if "learning_mode" not in learned_columns:
                    conn.execute("ALTER TABLE exam_learned ADD COLUMN learning_mode TEXT NOT NULL DEFAULT 'hash_based'")
                if "ocr_quality" not in learned_columns:
                    conn.execute("ALTER TABLE exam_learned ADD COLUMN ocr_quality TEXT NOT NULL DEFAULT 'unverified'")
                if "ocr_preview_unreliable" not in learned_columns:
                    conn.execute("ALTER TABLE exam_learned ADD COLUMN ocr_preview_unreliable INTEGER NOT NULL DEFAULT 1")
                if "verified_count" not in learned_columns:
                    conn.execute("ALTER TABLE exam_learned ADD COLUMN verified_count INTEGER NOT NULL DEFAULT 0")
                if "wrong_count" not in learned_columns:
                    conn.execute("ALTER TABLE exam_learned ADD COLUMN wrong_count INTEGER NOT NULL DEFAULT 0")
                if "last_verified_at" not in learned_columns:
                    conn.execute("ALTER TABLE exam_learned ADD COLUMN last_verified_at TEXT")
                if "status" not in learned_columns:
                    conn.execute("ALTER TABLE exam_learned ADD COLUMN status TEXT NOT NULL DEFAULT 'training'")

                # ── Performance indexes ──────────────────────────────
                conn.execute("CREATE INDEX IF NOT EXISTS idx_usage_task_status ON usage_events(task_type, status)")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_usage_key_id ON usage_events(key_id)")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_field_proposals_status ON field_mapping_proposals(status)")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_autofill_proposals_status ON autofill_rule_proposals(status, created_at)")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_exam_learned_phash ON exam_learned(question_phash)")

                conn.execute("INSERT OR IGNORE INTO access_control (key, value) VALUES ('global_access', 'true')")
                conn.commit()

        # Ensure the master key is created on first start
        self.api_keys.ensure_master_key()

    # --- Proxy Methods for Backward Compatibility ---

    # Settings
    def get_setting(self, *args, **kwargs): return self.settings.get_setting(*args, **kwargs)
    def set_setting(self, *args, **kwargs): return self.settings.set_setting(*args, **kwargs)
    def get_all_settings(self, *args, **kwargs): return self.settings.get_all_settings(*args, **kwargs)
    def get_global_access(self, *args, **kwargs): return self.settings.get_global_access(*args, **kwargs)
    def set_global_access(self, *args, **kwargs): return self.settings.set_global_access(*args, **kwargs)
    def get_allowed_domains(self, *args, **kwargs): return self.settings.get_allowed_domains(*args, **kwargs)
    def is_domain_allowed(self, *args, **kwargs): return self.settings.is_domain_allowed(*args, **kwargs)
    def add_allowed_domain(self, *args, **kwargs): return self.settings.add_allowed_domain(*args, **kwargs)
    def remove_allowed_domain(self, *args, **kwargs): return self.settings.remove_allowed_domain(*args, **kwargs)
    def export_master_setup(self, *args, **kwargs): return self.settings.export_master_setup(*args, **kwargs)
    def import_master_setup(self, *args, **kwargs): return self.settings.import_master_setup(*args, **kwargs)

    # API Keys
    def insert_api_key(self, *args, **kwargs): return self.api_keys.insert_api_key(*args, **kwargs)
    def get_api_key_by_hash(self, *args, **kwargs): return self.api_keys.get_api_key_by_hash(*args, **kwargs)
    def revoke_api_key(self, *args, **kwargs): return self.api_keys.revoke_api_key(*args, **kwargs)
    def revoke_api_key_by_id(self, *args, **kwargs): return self.api_keys.revoke_api_key_by_id(*args, **kwargs)
    def delete_revoked_api_key_by_id(self, *args, **kwargs): return self.api_keys.delete_revoked_api_key_by_id(*args, **kwargs)
    def insert_usage_event(self, *args, **kwargs): return self.api_keys.insert_usage_event(*args, **kwargs)
    def get_usage_summary(self, *args, **kwargs): return self.api_keys.get_usage_summary(*args, **kwargs)
    def get_all_api_keys(self, *args, **kwargs): return self.api_keys.get_all_api_keys(*args, **kwargs)
    def set_api_key_domain_scope(self, *args, **kwargs): return self.api_keys.set_api_key_domain_scope(*args, **kwargs)
    def get_api_key_allowed_domains(self, *args, **kwargs): return self.api_keys.get_api_key_allowed_domains(*args, **kwargs)
    def is_domain_allowed_for_key(self, *args, **kwargs): return self.api_keys.is_domain_allowed_for_key(*args, **kwargs)
    def set_api_key_rate_limit(self, *args, **kwargs): return self.api_keys.set_api_key_rate_limit(*args, **kwargs)
    def get_api_key_rate_limit(self, *args, **kwargs): return self.api_keys.get_api_key_rate_limit(*args, **kwargs)
    def set_api_key_entitlements(self, *args, **kwargs): return self.api_keys.set_api_key_entitlements(*args, **kwargs)
    def get_api_key_entitlements(self, *args, **kwargs): return self.api_keys.get_api_key_entitlements(*args, **kwargs)
    def validate_or_bind_key_device(self, *args, **kwargs): return self.api_keys.validate_or_bind_key_device(*args, **kwargs)
    def get_api_key_device_binding(self, *args, **kwargs): return self.api_keys.get_api_key_device_binding(*args, **kwargs)
    def ensure_master_key(self, *args, **kwargs): return self.api_keys.ensure_master_key(*args, **kwargs)
    def get_master_key_info(self, *args, **kwargs): return self.api_keys.get_master_key_info(*args, **kwargs)
    def is_master_key_hash(self, *args, **kwargs): return self.api_keys.is_master_key_hash(*args, **kwargs)

    # Models
    def get_model_route(self, *args, **kwargs): return self.models.get_model_route(*args, **kwargs)
    def set_model_route(self, *args, **kwargs): return self.models.set_model_route(*args, **kwargs)
    def get_all_model_routes(self, *args, **kwargs): return self.models.get_all_model_routes(*args, **kwargs)
    def add_model_registry_entry(self, *args, **kwargs): return self.models.add_model_registry_entry(*args, **kwargs)
    def get_model_registry(self, *args, **kwargs): return self.models.get_model_registry(*args, **kwargs)
    def get_model_registry_entry(self, *args, **kwargs): return self.models.get_model_registry_entry(*args, **kwargs)
    def delete_model_registry_entry(self, *args, **kwargs): return self.models.delete_model_registry_entry(*args, **kwargs)
    def update_model_registry_entry(self, *args, **kwargs): return self.models.update_model_registry_entry(*args, **kwargs)
    def set_field_mapping(self, *args, **kwargs): return self.models.set_field_mapping(*args, **kwargs)
    def remove_field_mapping(self, *args, **kwargs): return self.models.remove_field_mapping(*args, **kwargs)
    def update_field_mapping(self, *args, **kwargs): return self.models.update_field_mapping(*args, **kwargs)
    def rename_domain_mappings(self, *args, **kwargs): return self.models.rename_domain_mappings(*args, **kwargs)
    def assign_model_to_domain(self, *args, **kwargs): return self.models.assign_model_to_domain(*args, **kwargs)
    def get_all_field_mappings(self, *args, **kwargs): return self.models.get_all_field_mappings(*args, **kwargs)
    def get_domain_field_mappings(self, *args, **kwargs): return self.models.get_domain_field_mappings(*args, **kwargs)
    def get_all_domain_field_mappings(self, *args, **kwargs): return self.models.get_all_domain_field_mappings(*args, **kwargs)
    def propose_field_mapping(self, *args, **kwargs): return self.models.propose_field_mapping(*args, **kwargs)
    def get_pending_field_mapping_proposals(self, *args, **kwargs): return self.models.get_pending_field_mapping_proposals(*args, **kwargs)
    def mark_field_mapping_proposal_status(self, *args, **kwargs): return self.models.mark_field_mapping_proposal_status(*args, **kwargs)
    def delete_field_mapping_proposal(self, *args, **kwargs): return self.models.delete_field_mapping_proposal(*args, **kwargs)
    def update_field_mapping_proposal(self, *args, **kwargs): return self.models.update_field_mapping_proposal(*args, **kwargs)
    def get_field_mapped_model(self, *args, **kwargs): return self.models.get_field_mapped_model(*args, **kwargs)
    def set_lifecycle_state(self, *args, **kwargs): return self.models.set_lifecycle_state(*args, **kwargs)
    def get_latest_model_by_state(self, *args, **kwargs): return self.models.get_latest_model_by_state(*args, **kwargs)

    # Autofill
    def submit_autofill_proposal(self, *args, **kwargs): return self.autofill.submit_autofill_proposal(*args, **kwargs)
    def get_autofill_proposals(self, *args, **kwargs): return self.autofill.get_autofill_proposals(*args, **kwargs)
    def approve_autofill_proposal(self, *args, **kwargs): return self.autofill.approve_autofill_proposal(*args, **kwargs)
    def reject_autofill_proposal(self, *args, **kwargs): return self.autofill.reject_autofill_proposal(*args, **kwargs)
    def delete_autofill_proposal(self, *args, **kwargs): return self.autofill.delete_autofill_proposal(*args, **kwargs)
    def update_autofill_proposal(self, *args, **kwargs): return self.autofill.update_autofill_proposal(*args, **kwargs)
    def get_approved_autofill_rules(self, *args, **kwargs): return self.autofill.get_approved_autofill_rules(*args, **kwargs)
    def propose_locator(self, *args, **kwargs): return self.autofill.propose_locator(*args, **kwargs)
    def get_pending_locators(self, *args, **kwargs): return self.autofill.get_pending_locators(*args, **kwargs)
    def get_approved_locators(self, *args, **kwargs): return self.autofill.get_approved_locators(*args, **kwargs)
    def approve_locator(self, *args, **kwargs): return self.autofill.approve_locator(*args, **kwargs)
    def reject_locator(self, *args, **kwargs): return self.autofill.reject_locator(*args, **kwargs)

    # Exam
    def get_exam_stats(self, *args, **kwargs): return self.exam.get_exam_stats(*args, **kwargs)

    # Exam Attempts (self-learning feedback)
    def insert_exam_attempt(self, *args, **kwargs): return self.exam_attempts.insert_attempt(*args, **kwargs)
    def get_exam_attempts_by_hash(self, *args, **kwargs): return self.exam_attempts.get_attempts_by_hash(*args, **kwargs)
    def get_exam_attempts_stats(self, *args, **kwargs): return self.exam_attempts.get_stats(*args, **kwargs)

    # Exam Learned (self-learning question bank)
    def upsert_exam_learned(self, *args, **kwargs): return self.exam_learned.upsert_learned(*args, **kwargs)
    def get_exam_learned_by_hash(self, *args, **kwargs): return self.exam_learned.get_by_hash(*args, **kwargs)
    def get_all_exam_learned(self, *args, **kwargs): return self.exam_learned.get_all_learned(*args, **kwargs)
    def get_exam_learned_stats(self, *args, **kwargs): return self.exam_learned.get_stats(*args, **kwargs)
    def export_exam_learned_json(self, *args, **kwargs): return self.exam_learned.export_to_json(*args, **kwargs)

    # Training
    def insert_retrain_sample(self, *args, **kwargs): return self.training.insert_retrain_sample(*args, **kwargs)
    def get_retrain_samples(self, *args, **kwargs): return self.training.get_retrain_samples(*args, **kwargs)
    def label_retrain_sample(self, *args, **kwargs): return self.training.label_retrain_sample(*args, **kwargs)
    def reject_retrain_sample(self, *args, **kwargs): return self.training.reject_retrain_sample(*args, **kwargs)
    def get_retrain_sample_counts(self, *args, **kwargs): return self.training.get_retrain_sample_counts(*args, **kwargs)
    def upsert_failed_payload_label(self, *args, **kwargs): return self.training.upsert_failed_payload_label(*args, **kwargs)
    def get_failed_payload_labels(self, *args, **kwargs): return self.training.get_failed_payload_labels(*args, **kwargs)
    def create_retrain_job(self, *args, **kwargs): return self.training.create_retrain_job(*args, **kwargs)
    def get_due_retrain_jobs(self, *args, **kwargs): return self.training.get_due_retrain_jobs(*args, **kwargs)
    def mark_retrain_job_running(self, job_id: int): return self.training.mark_retrain_job_running(job_id)
    def mark_retrain_job_done(self, *args, **kwargs): return self.training.mark_retrain_job_done(*args, **kwargs)
    def mark_retrain_job_failed(self, *args, **kwargs): return self.training.mark_retrain_job_failed(*args, **kwargs)
    def get_retrain_jobs(self, *args, **kwargs): return self.training.get_retrain_jobs(*args, **kwargs)
    def claim_labeled_samples(self, *args, **kwargs): return self.training.claim_labeled_samples(*args, **kwargs)
    def release_job_claims(self, job_id: int): return self.training.release_job_claims(job_id)
    def insert_active_learning(self, *args, **kwargs): return self.training.insert_active_learning(*args, **kwargs)
    def get_active_learning_samples(self, *args, **kwargs): return self.training.get_active_learning_samples(*args, **kwargs)

    # Automation Methods
    def list_automation_methods(self, *args, **kwargs): return self.automation_methods.list_automation_methods(*args, **kwargs)
    def get_automation_method(self, *args, **kwargs): return self.automation_methods.get_automation_method(*args, **kwargs)
    def get_active_automation_method(self, *args, **kwargs): return self.automation_methods.get_active_automation_method(*args, **kwargs)
    def create_automation_method(self, *args, **kwargs): return self.automation_methods.create_automation_method(*args, **kwargs)
    def update_automation_method(self, *args, **kwargs): return self.automation_methods.update_automation_method(*args, **kwargs)
    def activate_automation_method(self, *args, **kwargs): return self.automation_methods.activate_automation_method(*args, **kwargs)
    def delete_automation_method(self, *args, **kwargs): return self.automation_methods.delete_automation_method(*args, **kwargs)
