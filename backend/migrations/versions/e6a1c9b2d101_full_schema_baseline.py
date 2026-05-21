"""full_schema_baseline

Revision ID: e6a1c9b2d101
Revises: c3f4a9d8e2b1
Create Date: 2026-05-19 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'e6a1c9b2d101'
down_revision: Union[str, Sequence[str], None] = 'c3f4a9d8e2b1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS api_keys (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            key_hash TEXT NOT NULL UNIQUE,
            enabled INTEGER NOT NULL DEFAULT 1,
            all_domains INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL,
            expires_at TEXT,
            revoked_at TEXT,
            key_type TEXT NOT NULL DEFAULT 'user',
            plan_name TEXT NOT NULL DEFAULT 'Standard',
            mobile TEXT NOT NULL DEFAULT '',
            telegram_id TEXT NOT NULL DEFAULT '',
            services_json TEXT NOT NULL DEFAULT '{}'
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS api_key_allowed_domains (
            key_id INTEGER NOT NULL,
            domain TEXT NOT NULL,
            PRIMARY KEY (key_id, domain),
            FOREIGN KEY(key_id) REFERENCES api_keys(id)
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS api_key_rate_limits (
            key_id INTEGER PRIMARY KEY,
            requests_per_minute INTEGER NOT NULL,
            burst INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY(key_id) REFERENCES api_keys(id)
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS api_key_device_bindings (
            key_id INTEGER PRIMARY KEY,
            device_id TEXT NOT NULL,
            user_agent TEXT,
            first_seen_at TEXT NOT NULL,
            last_seen_at TEXT NOT NULL,
            FOREIGN KEY(key_id) REFERENCES api_keys(id)
        )
        """
    )
    op.execute(
        """
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
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS model_routes (
            domain TEXT PRIMARY KEY,
            ai_model_filename TEXT NOT NULL
        )
        """
    )
    op.execute(
        """
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
        )
        """
    )
    op.execute(
        """
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
        )
        """
    )
    op.execute(
        """
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
        )
        """
    )
    op.execute(
        """
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
        )
        """
    )
    op.execute(
        """
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
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS model_lifecycle_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ai_model_id INTEGER NOT NULL,
            from_state TEXT,
            to_state TEXT NOT NULL,
            reason TEXT,
            changed_by INTEGER,
            created_at TEXT NOT NULL,
            FOREIGN KEY(ai_model_id) REFERENCES model_registry(id)
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS active_learning (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            domain TEXT NOT NULL,
            image_path TEXT NOT NULL,
            reported_by INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY(reported_by) REFERENCES api_keys(id)
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS access_control (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS allowed_domains (
            domain TEXT PRIMARY KEY
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS locators (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            domain TEXT NOT NULL,
            image_selector TEXT NOT NULL,
            input_selector TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            created_at TEXT NOT NULL
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS failed_payload_labels (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            filename TEXT NOT NULL UNIQUE,
            domain TEXT NOT NULL,
            ai_guess TEXT,
            corrected_text TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS platform_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL DEFAULT '',
            description TEXT,
            updated_at TEXT NOT NULL
        )
        """
    )
    op.execute(
        """
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
        )
        """
    )
    op.execute(
        """
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
        )
        """
    )
    op.execute(
        """
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
            correct_option_hash TEXT NOT NULL DEFAULT '',
            correct_option_phash TEXT NOT NULL DEFAULT '',
            correct_option_text TEXT NOT NULL DEFAULT '',
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
        )
        """
    )
    op.execute(
        """
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
        )
        """
    )

    op.execute("CREATE INDEX IF NOT EXISTS idx_usage_task_status ON usage_events(task_type, status)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_usage_key_id ON usage_events(key_id)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_field_proposals_status ON field_mapping_proposals(status)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_autofill_proposals_status ON autofill_rule_proposals(status, created_at)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_exam_learned_phash ON exam_learned(question_phash)")

    op.execute("INSERT OR IGNORE INTO access_control (key, value) VALUES ('global_access', 'true')")


def downgrade() -> None:
    for table in [
        "automation_methods",
        "exam_learned",
        "exam_attempts",
        "autofill_rule_proposals",
        "failed_payload_labels",
        "locators",
        "allowed_domains",
        "access_control",
        "active_learning",
        "model_lifecycle_events",
        "retrain_jobs",
        "retrain_samples",
        "field_mapping_proposals",
        "field_mappings",
        "model_registry",
        "model_routes",
        "usage_events",
        "api_key_device_bindings",
        "api_key_rate_limits",
        "api_key_allowed_domains",
        "api_keys",
        "platform_settings",
    ]:
        op.execute(f"DROP TABLE IF EXISTS {table}")
