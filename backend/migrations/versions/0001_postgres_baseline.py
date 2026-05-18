"""postgres_baseline

Revision ID: 0001_postgres_baseline
Revises:
Create Date: 2026-05-18
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0001_postgres_baseline"
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('access_control',
        sa.Column('key', sa.String(length=255), nullable=False),
        sa.Column('value', sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint('key'),
    )

    op.create_table('active_learning',
        sa.Column('id', sa.Integer(), nullable=False, autoincrement=True),
        sa.Column('domain', sa.String(length=255), nullable=False),
        sa.Column('image_path', sa.String(length=1024), nullable=False),
        sa.Column('reported_by', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.String(length=64), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )

    op.create_table('allowed_domains',
        sa.Column('domain', sa.String(length=255), nullable=False),
        sa.PrimaryKeyConstraint('domain'),
    )

    op.create_table('api_key_allowed_domains',
        sa.Column('key_id', sa.Integer(), nullable=False),
        sa.Column('domain', sa.String(length=255), nullable=False),
        sa.PrimaryKeyConstraint('key_id', 'domain'),
    )

    op.create_table('api_key_device_bindings',
        sa.Column('key_id', sa.Integer(), nullable=False),
        sa.Column('device_id', sa.String(length=255), nullable=False),
        sa.Column('user_agent', sa.String(length=512), nullable=True),
        sa.Column('first_seen_at', sa.String(length=64), nullable=False),
        sa.Column('last_seen_at', sa.String(length=64), nullable=False),
        sa.PrimaryKeyConstraint('key_id'),
    )

    op.create_table('api_key_rate_limits',
        sa.Column('key_id', sa.Integer(), nullable=False),
        sa.Column('requests_per_minute', sa.Integer(), nullable=False),
        sa.Column('burst', sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint('key_id'),
    )

    op.create_table('api_keys',
        sa.Column('id', sa.Integer(), nullable=False, autoincrement=True),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('key_hash', sa.String(length=255), nullable=False),
        sa.Column('enabled', sa.Integer(), nullable=False),
        sa.Column('all_domains', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.String(length=64), nullable=False),
        sa.Column('expires_at', sa.String(length=64), nullable=True),
        sa.Column('revoked_at', sa.String(length=64), nullable=True),
        sa.Column('key_type', sa.String(length=32), nullable=False),
        sa.Column('plan_name', sa.String(length=255), nullable=False),
        sa.Column('mobile', sa.String(length=64), nullable=False),
        sa.Column('telegram_id', sa.String(length=64), nullable=False),
        sa.Column('services_json', sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('key_hash'),
    )

    op.create_table('audit_logs',
        sa.Column('id', sa.Integer(), nullable=False, autoincrement=True),
        sa.Column('actor_type', sa.String(length=32), nullable=False),
        sa.Column('actor_id', sa.Integer(), nullable=True),
        sa.Column('action', sa.String(length=128), nullable=False),
        sa.Column('target_type', sa.String(length=64), nullable=True),
        sa.Column('target_id', sa.Integer(), nullable=True),
        sa.Column('before_json', sa.Text(), nullable=True),
        sa.Column('after_json', sa.Text(), nullable=True),
        sa.Column('ip_address', sa.String(length=45), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )

    op.create_table('autofill_rule_proposals',
        sa.Column('id', sa.Integer(), nullable=False, autoincrement=True),
        sa.Column('idempotency_key', sa.String(length=255), nullable=True),
        sa.Column('device_id', sa.String(length=255), nullable=True),
        sa.Column('api_key_id', sa.Integer(), nullable=True),
        sa.Column('status', sa.String(length=32), nullable=False),
        sa.Column('reviewed_by', sa.String(length=255), nullable=True),
        sa.Column('reviewed_at', sa.String(length=64), nullable=True),
        sa.Column('submitted_at', sa.String(length=64), nullable=True),
        sa.Column('rule_json', sa.Text(), nullable=False),
        sa.Column('approved_rule_id', sa.String(length=255), nullable=True),
        sa.Column('created_at', sa.String(length=64), nullable=False),
        sa.UniqueConstraint('idempotency_key'),
        sa.PrimaryKeyConstraint('id'),
    )

    op.create_table('backup_runs',
        sa.Column('id', sa.Integer(), nullable=False, autoincrement=True),
        sa.Column('backup_type', sa.String(length=32), nullable=False),
        sa.Column('status', sa.String(length=32), nullable=False),
        sa.Column('storage_target', sa.String(length=512), nullable=True),
        sa.Column('started_at', sa.DateTime(), nullable=False),
        sa.Column('finished_at', sa.DateTime(), nullable=True),
        sa.Column('file_path_or_uri', sa.String(length=1024), nullable=True),
        sa.Column('filename', sa.String(length=512), nullable=True),
        sa.Column('file_size_bytes', sa.Integer(), nullable=True),
        sa.Column('encrypted', sa.Boolean(), nullable=False),
        sa.Column('telegram_enabled', sa.Boolean(), nullable=False),
        sa.Column('telegram_status', sa.String(length=64), nullable=True),
        sa.Column('telegram_chat_id', sa.String(length=128), nullable=True),
        sa.Column('telegram_message_id', sa.String(length=128), nullable=True),
        sa.Column('rclone_enabled', sa.Boolean(), nullable=False),
        sa.Column('rclone_status', sa.String(length=64), nullable=True),
        sa.Column('rclone_destination', sa.String(length=512), nullable=True),
        sa.Column('trigger_type', sa.String(length=32), nullable=False),
        sa.Column('schedule_name', sa.String(length=128), nullable=True),
        sa.Column('next_run_at', sa.DateTime(), nullable=True),
        sa.Column('triggered_by', sa.String(length=128), nullable=True),
        sa.Column('checksum', sa.String(length=128), nullable=True),
        sa.Column('error_summary', sa.Text(), nullable=True),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )

    op.create_table('exam_attempts',
        sa.Column('id', sa.Integer(), nullable=False, autoincrement=True),
        sa.Column('question_hash', sa.String(length=255), nullable=False),
        sa.Column('selected_option', sa.Integer(), nullable=False),
        sa.Column('was_correct', sa.Integer(), nullable=False),
        sa.Column('method', sa.String(length=64), nullable=True),
        sa.Column('processing_ms', sa.Integer(), nullable=False),
        sa.Column('domain', sa.String(length=255), nullable=True),
        sa.Column('question_num', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.String(length=64), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_exam_attempts_question_hash', 'exam_attempts', ['question_hash'], unique=False)

    op.create_table('exam_learned',
        sa.Column('id', sa.Integer(), nullable=False, autoincrement=True),
        sa.Column('question_hash', sa.String(length=255), nullable=False),
        sa.Column('question_phash', sa.String(length=64), nullable=False),
        sa.Column('question_text', sa.Text(), nullable=True),
        sa.Column('option_1', sa.Text(), nullable=True),
        sa.Column('option_2', sa.Text(), nullable=True),
        sa.Column('option_3', sa.Text(), nullable=True),
        sa.Column('option_4', sa.Text(), nullable=True),
        sa.Column('correct_option', sa.Integer(), nullable=False),
        sa.Column('correct_option_hash', sa.String(length=255), nullable=False),
        sa.Column('correct_option_phash', sa.String(length=64), nullable=False),
        sa.Column('correct_option_text', sa.Text(), nullable=False),
        sa.Column('confidence', sa.Float(), nullable=False),
        sa.Column('seen_count', sa.Integer(), nullable=False),
        sa.Column('first_seen', sa.String(length=64), nullable=False),
        sa.Column('last_seen', sa.String(length=64), nullable=False),
        sa.Column('source', sa.String(length=64), nullable=False),
        sa.Column('learning_mode', sa.String(length=64), nullable=False),
        sa.Column('ocr_quality', sa.String(length=64), nullable=False),
        sa.Column('ocr_preview_unreliable', sa.Integer(), nullable=False),
        sa.Column('verified_count', sa.Integer(), nullable=False),
        sa.Column('wrong_count', sa.Integer(), nullable=False),
        sa.Column('last_verified_at', sa.String(length=64), nullable=True),
        sa.Column('status', sa.String(length=32), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_exam_learned_question_hash', 'exam_learned', ['question_hash'], unique=True)
    op.create_index('ix_exam_learned_question_phash', 'exam_learned', ['question_phash'], unique=False)

    op.create_table('failed_payload_labels',
        sa.Column('id', sa.Integer(), nullable=False, autoincrement=True),
        sa.Column('filename', sa.String(length=512), nullable=False),
        sa.Column('domain', sa.String(length=255), nullable=False),
        sa.Column('ai_guess', sa.Text(), nullable=True),
        sa.Column('corrected_text', sa.Text(), nullable=False),
        sa.Column('updated_at', sa.String(length=64), nullable=False),
        sa.UniqueConstraint('filename'),
        sa.PrimaryKeyConstraint('id'),
    )

    op.create_table('field_mapping_proposals',
        sa.Column('id', sa.Integer(), nullable=False, autoincrement=True),
        sa.Column('domain', sa.String(length=255), nullable=False),
        sa.Column('task_type', sa.String(length=64), nullable=False),
        sa.Column('source_data_type', sa.String(length=64), nullable=False),
        sa.Column('source_selector', sa.Text(), nullable=False),
        sa.Column('target_data_type', sa.String(length=64), nullable=False),
        sa.Column('target_selector', sa.Text(), nullable=False),
        sa.Column('proposed_field_name', sa.String(length=255), nullable=False),
        sa.Column('reported_by', sa.Integer(), nullable=False),
        sa.Column('status', sa.String(length=32), nullable=False),
        sa.Column('created_at', sa.String(length=64), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )

    op.create_table('field_mappings',
        sa.Column('id', sa.Integer(), nullable=False, autoincrement=True),
        sa.Column('domain', sa.String(length=255), nullable=False),
        sa.Column('field_name', sa.String(length=255), nullable=False),
        sa.Column('task_type', sa.String(length=64), nullable=False),
        sa.Column('source_data_type', sa.String(length=64), nullable=False),
        sa.Column('source_selector', sa.Text(), nullable=False),
        sa.Column('target_data_type', sa.String(length=64), nullable=False),
        sa.Column('target_selector', sa.Text(), nullable=False),
        sa.Column('ai_model_id', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.String(length=64), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('domain', 'field_name', 'task_type', name='uq_field_mapping_key'),
    )

    op.create_table('locators',
        sa.Column('id', sa.Integer(), nullable=False, autoincrement=True),
        sa.Column('domain', sa.String(length=255), nullable=False),
        sa.Column('image_selector', sa.Text(), nullable=False),
        sa.Column('input_selector', sa.Text(), nullable=False),
        sa.Column('status', sa.String(length=32), nullable=False),
        sa.Column('created_at', sa.String(length=64), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )

    op.create_table('model_lifecycle_events',
        sa.Column('id', sa.Integer(), nullable=False, autoincrement=True),
        sa.Column('ai_model_id', sa.Integer(), nullable=False),
        sa.Column('from_state', sa.String(length=32), nullable=True),
        sa.Column('to_state', sa.String(length=32), nullable=False),
        sa.Column('reason', sa.Text(), nullable=True),
        sa.Column('changed_by', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.String(length=64), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )

    op.create_table('model_registry',
        sa.Column('id', sa.Integer(), nullable=False, autoincrement=True),
        sa.Column('ai_model_name', sa.String(length=255), nullable=False),
        sa.Column('version', sa.String(length=64), nullable=False),
        sa.Column('task_type', sa.String(length=64), nullable=False),
        sa.Column('ai_runtime', sa.String(length=64), nullable=False),
        sa.Column('ai_model_filename', sa.String(length=512), nullable=False),
        sa.Column('status', sa.String(length=32), nullable=False),
        sa.Column('lifecycle_state', sa.String(length=32), nullable=False),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('created_at', sa.String(length=64), nullable=False),
        sa.Column('updated_at', sa.String(length=64), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('ai_model_filename'),
    )

    op.create_table('model_routes',
        sa.Column('domain', sa.String(length=255), nullable=False),
        sa.Column('ai_model_filename', sa.String(length=512), nullable=False),
        sa.PrimaryKeyConstraint('domain'),
    )

    op.create_table('platform_settings',
        sa.Column('key', sa.String(length=255), nullable=False),
        sa.Column('value', sa.Text(), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('updated_at', sa.String(length=64), nullable=False),
        sa.PrimaryKeyConstraint('key'),
    )

    op.create_table('retrain_jobs',
        sa.Column('id', sa.Integer(), nullable=False, autoincrement=True),
        sa.Column('status', sa.String(length=32), nullable=False),
        sa.Column('scheduled_for', sa.String(length=64), nullable=False),
        sa.Column('started_at', sa.String(length=64), nullable=True),
        sa.Column('finished_at', sa.String(length=64), nullable=True),
        sa.Column('requested_by', sa.Integer(), nullable=True),
        sa.Column('min_samples', sa.Integer(), nullable=False),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column('produced_ai_model_id', sa.Integer(), nullable=True),
        sa.Column('total_samples', sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )

    op.create_table('retrain_samples',
        sa.Column('id', sa.Integer(), nullable=False, autoincrement=True),
        sa.Column('domain', sa.String(length=255), nullable=False),
        sa.Column('image_path', sa.String(length=1024), nullable=False),
        sa.Column('task_type', sa.String(length=64), nullable=False),
        sa.Column('field_name', sa.String(length=255), nullable=True),
        sa.Column('reported_by', sa.Integer(), nullable=False),
        sa.Column('status', sa.String(length=32), nullable=False),
        sa.Column('label_text', sa.Text(), nullable=True),
        sa.Column('labeled_by', sa.Integer(), nullable=True),
        sa.Column('labeled_at', sa.String(length=64), nullable=True),
        sa.Column('consumed_by_job_id', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.String(length=64), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )

    op.create_table('subscription_plans',
        sa.Column('id', sa.Integer(), nullable=False, autoincrement=True),
        sa.Column('code', sa.String(length=64), nullable=False),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('monthly_limit', sa.Integer(), nullable=False),
        sa.Column('duration_days', sa.Integer(), nullable=False),
        sa.Column('price_amount', sa.Integer(), nullable=False),
        sa.Column('currency', sa.String(length=3), nullable=False),
        sa.Column('services_json', sa.Text(), nullable=False),
        sa.Column('service_limits_json', sa.Text(), nullable=False),
        sa.Column('is_active', sa.Boolean(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('code'),
    )

    op.create_table('usage_events',
        sa.Column('id', sa.Integer(), nullable=False, autoincrement=True),
        sa.Column('key_id', sa.Integer(), nullable=False),
        sa.Column('task_type', sa.String(length=64), nullable=False),
        sa.Column('status', sa.String(length=32), nullable=False),
        sa.Column('processing_ms', sa.Integer(), nullable=False),
        sa.Column('model_used', sa.String(length=255), nullable=True),
        sa.Column('domain', sa.String(length=255), nullable=True),
        sa.Column('ip', sa.String(length=45), nullable=True),
        sa.Column('created_at', sa.String(length=64), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_usage_events_key_id', 'usage_events', ['key_id'], unique=False)

    op.create_table('users',
        sa.Column('id', sa.Integer(), nullable=False, autoincrement=True),
        sa.Column('full_name', sa.String(length=255), nullable=False),
        sa.Column('mobile_number', sa.String(length=20), nullable=True),
        sa.Column('telegram_user_id', sa.String(length=64), nullable=True),
        sa.Column('telegram_chat_id', sa.String(length=64), nullable=True),
        sa.Column('status', sa.String(length=32), nullable=False),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.Column('created_by_admin_id', sa.Integer(), nullable=True),
        sa.Column('updated_by_admin_id', sa.Integer(), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('telegram_user_id'),
        sa.UniqueConstraint('mobile_number'),
    )

    op.create_table('request_jobs',
        sa.Column('id', sa.Integer(), nullable=False, autoincrement=True),
        sa.Column('user_id', sa.Integer(), nullable=True),
        sa.Column('api_key_id', sa.Integer(), nullable=True),
        sa.Column('request_id', sa.String(length=64), nullable=True),
        sa.Column('job_type', sa.String(length=64), nullable=False),
        sa.Column('priority', sa.Integer(), nullable=False),
        sa.Column('status', sa.String(length=32), nullable=False),
        sa.Column('payload_ref', sa.String(length=512), nullable=True),
        sa.Column('result_ref', sa.String(length=512), nullable=True),
        sa.Column('attempt_count', sa.Integer(), nullable=False),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column('queued_at', sa.DateTime(), nullable=False),
        sa.Column('started_at', sa.DateTime(), nullable=True),
        sa.Column('finished_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.id']),
        sa.UniqueConstraint('request_id'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_request_jobs_user_id', 'request_jobs', ['user_id'], unique=False)

    op.create_table('user_api_keys',
        sa.Column('id', sa.Integer(), nullable=False, autoincrement=True),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('key_hash', sa.String(length=255), nullable=False),
        sa.Column('key_prefix_display', sa.String(length=16), nullable=False),
        sa.Column('status', sa.String(length=32), nullable=False),
        sa.Column('key_version', sa.Integer(), nullable=False),
        sa.Column('issued_at', sa.DateTime(), nullable=False),
        sa.Column('expires_at', sa.DateTime(), nullable=True),
        sa.Column('last_used_at', sa.DateTime(), nullable=True),
        sa.Column('usage_count', sa.Integer(), nullable=False),
        sa.Column('revoked_at', sa.DateTime(), nullable=True),
        sa.Column('revoked_reason', sa.String(length=255), nullable=True),
        sa.Column('rotated_from_key_id', sa.Integer(), nullable=True),
        sa.Column('created_by_admin_id', sa.Integer(), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('key_hash'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id']),
    )
    op.create_index('ix_user_api_keys_user_id', 'user_api_keys', ['user_id'], unique=False)

    op.create_table('user_subscriptions',
        sa.Column('id', sa.Integer(), nullable=False, autoincrement=True),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('plan_id', sa.Integer(), nullable=False),
        sa.Column('status', sa.String(length=32), nullable=False),
        sa.Column('monthly_limit_snapshot', sa.Integer(), nullable=False),
        sa.Column('services_snapshot_json', sa.Text(), nullable=False),
        sa.Column('service_limits_snapshot_json', sa.Text(), nullable=False),
        sa.Column('start_at', sa.DateTime(), nullable=True),
        sa.Column('end_at', sa.DateTime(), nullable=True),
        sa.Column('billing_anchor_day', sa.Integer(), nullable=True),
        sa.Column('current_cycle_start_at', sa.DateTime(), nullable=True),
        sa.Column('current_cycle_end_at', sa.DateTime(), nullable=True),
        sa.Column('auto_renew_enabled', sa.Boolean(), nullable=False),
        sa.Column('approved_by_admin_id', sa.Integer(), nullable=True),
        sa.Column('approved_at', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id']),
        sa.ForeignKeyConstraint(['plan_id'], ['subscription_plans.id']),
    )
    op.create_index('ix_user_subscriptions_user_id', 'user_subscriptions', ['user_id'], unique=False)

    op.create_table('payment_records',
        sa.Column('id', sa.Integer(), nullable=False, autoincrement=True),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('subscription_id', sa.Integer(), nullable=True),
        sa.Column('plan_id', sa.Integer(), nullable=True),
        sa.Column('telegram_user_id', sa.String(length=64), nullable=True),
        sa.Column('payment_method', sa.String(length=32), nullable=False),
        sa.Column('amount', sa.Integer(), nullable=False),
        sa.Column('currency', sa.String(length=3), nullable=False),
        sa.Column('payment_ref', sa.String(length=255), nullable=True),
        sa.Column('upi_id_used', sa.String(length=255), nullable=True),
        sa.Column('payee_name_used', sa.String(length=255), nullable=True),
        sa.Column('upi_reference', sa.String(length=255), nullable=True),
        sa.Column('payer_name', sa.String(length=255), nullable=True),
        sa.Column('payment_screenshot_path', sa.String(length=512), nullable=True),
        sa.Column('payment_note', sa.Text(), nullable=True),
        sa.Column('ocr_matched', sa.Boolean(), nullable=True),
        sa.Column('ocr_extracted_ref', sa.String(length=255), nullable=True),
        sa.Column('ocr_extracted_amount', sa.String(length=64), nullable=True),
        sa.Column('ocr_extracted_date', sa.String(length=64), nullable=True),
        sa.Column('ocr_extracted_payer', sa.String(length=255), nullable=True),
        sa.Column('status', sa.String(length=32), nullable=False),
        sa.Column('submitted_at', sa.DateTime(), nullable=True),
        sa.Column('expires_at', sa.DateTime(), nullable=True),
        sa.Column('verified_by_admin_id', sa.Integer(), nullable=True),
        sa.Column('verified_at', sa.DateTime(), nullable=True),
        sa.Column('rejection_reason', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['plan_id'], ['subscription_plans.id']),
        sa.ForeignKeyConstraint(['user_id'], ['users.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['subscription_id'], ['user_subscriptions.id']),
    )
    op.create_index('ix_payment_records_user_id', 'payment_records', ['user_id'], unique=False)

    op.create_table('usage_cycles',
        sa.Column('id', sa.Integer(), nullable=False, autoincrement=True),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('subscription_id', sa.Integer(), nullable=False),
        sa.Column('cycle_start_at', sa.DateTime(), nullable=False),
        sa.Column('cycle_end_at', sa.DateTime(), nullable=False),
        sa.Column('monthly_limit', sa.Integer(), nullable=False),
        sa.Column('used_count', sa.Integer(), nullable=False),
        sa.Column('blocked_at_limit', sa.Boolean(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['subscription_id'], ['user_subscriptions.id']),
    )
    op.create_index('ix_usage_cycles_user_id', 'usage_cycles', ['user_id'], unique=False)

    op.create_table('user_api_key_devices',
        sa.Column('id', sa.Integer(), nullable=False, autoincrement=True),
        sa.Column('api_key_id', sa.Integer(), nullable=False),
        sa.Column('device_fingerprint', sa.String(length=255), nullable=False),
        sa.Column('device_name', sa.String(length=255), nullable=True),
        sa.Column('user_agent', sa.String(length=512), nullable=True),
        sa.Column('first_seen_at', sa.DateTime(), nullable=False),
        sa.Column('last_seen_at', sa.DateTime(), nullable=False),
        sa.Column('status', sa.String(length=32), nullable=False),
        sa.ForeignKeyConstraint(['api_key_id'], ['user_api_keys.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('api_key_id', 'device_fingerprint', name='uq_key_device'),
    )
    op.create_index('ix_user_api_key_devices_api_key_id', 'user_api_key_devices', ['api_key_id'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_user_api_key_devices_api_key_id', table_name='user_api_key_devices')
    op.drop_index('ix_usage_cycles_user_id', table_name='usage_cycles')
    op.drop_index('ix_payment_records_user_id', table_name='payment_records')
    op.drop_index('ix_user_subscriptions_user_id', table_name='user_subscriptions')
    op.drop_index('ix_user_api_keys_user_id', table_name='user_api_keys')
    op.drop_index('ix_request_jobs_user_id', table_name='request_jobs')
    op.drop_index('ix_usage_events_key_id', table_name='usage_events')
    op.drop_index('ix_exam_learned_question_phash', table_name='exam_learned')
    op.drop_index('ix_exam_learned_question_hash', table_name='exam_learned')
    op.drop_index('ix_exam_attempts_question_hash', table_name='exam_attempts')

    op.drop_table('user_api_key_devices')
    op.drop_table('usage_cycles')
    op.drop_table('payment_records')
    op.drop_table('user_subscriptions')
    op.drop_table('user_api_keys')
    op.drop_table('request_jobs')
    op.drop_table('users')
    op.drop_table('usage_events')
    op.drop_table('subscription_plans')
    op.drop_table('retrain_samples')
    op.drop_table('retrain_jobs')
    op.drop_table('platform_settings')
    op.drop_table('model_routes')
    op.drop_table('model_registry')
    op.drop_table('model_lifecycle_events')
    op.drop_table('locators')
    op.drop_table('field_mappings')
    op.drop_table('field_mapping_proposals')
    op.drop_table('failed_payload_labels')
    op.drop_table('exam_learned')
    op.drop_table('exam_attempts')
    op.drop_table('backup_runs')
    op.drop_table('autofill_rule_proposals')
    op.drop_table('audit_logs')
    op.drop_table('api_keys')
    op.drop_table('api_key_rate_limits')
    op.drop_table('api_key_device_bindings')
    op.drop_table('api_key_allowed_domains')
    op.drop_table('allowed_domains')
    op.drop_table('active_learning')
    op.drop_table('access_control')
