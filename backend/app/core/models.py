"""Domain models — users, subscriptions, payments, usage cycles, audit logs.

These models use SQLAlchemy ORM and run on PostgreSQL.
They coexist with the existing raw-SQL tables (api_keys, usage_events, etc.).
"""

from __future__ import annotations

import json
from datetime import UTC, datetime

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship

from app.core.db import Base


def _utcnow() -> datetime:
    return datetime.now(UTC)


def _json_dict(value: str | None) -> dict:
    try:
        parsed = json.loads(value or "{}")
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        return {}


# ═══════════════════════════════════════════════════════════════════════════════
# USERS
# ═══════════════════════════════════════════════════════════════════════════════

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, autoincrement=True)
    full_name = Column(String(255), nullable=False, default="")
    mobile_number = Column(String(20), unique=True, nullable=True)
    telegram_user_id = Column(String(64), unique=True, nullable=True)
    telegram_chat_id = Column(String(64), nullable=True)
    status = Column(
        String(32),
        nullable=False,
        default="pending_payment",
        # Values: pending_payment, pending_approval, active, blocked, inactive, expired, deleted
    )
    notes = Column(Text, default="")
    created_at = Column(DateTime, nullable=False, default=_utcnow)
    updated_at = Column(DateTime, nullable=False, default=_utcnow, onupdate=_utcnow)
    created_by_admin_id = Column(Integer, nullable=True)
    updated_by_admin_id = Column(Integer, nullable=True)

    # Relationships
    subscriptions = relationship("UserSubscription", back_populates="user", lazy="dynamic")
    payments = relationship("PaymentRecord", back_populates="user", lazy="dynamic")
    api_keys = relationship("UserApiKey", back_populates="user", lazy="dynamic")

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "full_name": self.full_name,
            "mobile_number": self.mobile_number,
            "telegram_user_id": self.telegram_user_id,
            "telegram_chat_id": self.telegram_chat_id,
            "status": self.status,
            "notes": self.notes,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }


# ═══════════════════════════════════════════════════════════════════════════════
# SUBSCRIPTION PLANS
# ═══════════════════════════════════════════════════════════════════════════════

class SubscriptionPlan(Base):
    __tablename__ = "subscription_plans"

    id = Column(Integer, primary_key=True, autoincrement=True)
    code = Column(String(64), unique=True, nullable=False)
    name = Column(String(255), nullable=False)
    description = Column(Text, default="")
    monthly_limit = Column(Integer, nullable=False, default=3000)
    duration_days = Column(Integer, nullable=False, default=30)
    price_amount = Column(Integer, nullable=False, default=0)  # in smallest currency unit (e.g., paise)
    currency = Column(String(3), nullable=False, default="INR")
    services_json = Column(Text, nullable=False, default='{"autofill":true,"captcha":true,"stall":false,"solver":false,"custom":false}')
    service_limits_json = Column(Text, nullable=False, default="{}")
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime, nullable=False, default=_utcnow)
    updated_at = Column(DateTime, nullable=False, default=_utcnow, onupdate=_utcnow)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "code": self.code,
            "name": self.name,
            "description": self.description,
            "monthly_limit": self.monthly_limit,
            "duration_days": self.duration_days,
            "price_amount": self.price_amount,
            "currency": self.currency,
            "services": _json_dict(self.services_json),
            "service_limits": _json_dict(self.service_limits_json),
            "is_active": self.is_active,
        }


# ═══════════════════════════════════════════════════════════════════════════════
# USER SUBSCRIPTIONS
# ═══════════════════════════════════════════════════════════════════════════════

class UserSubscription(Base):
    __tablename__ = "user_subscriptions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    plan_id = Column(Integer, ForeignKey("subscription_plans.id"), nullable=False)
    status = Column(
        String(32),
        nullable=False,
        default="pending",
        # Values: pending, active, expired, cancelled, rejected
    )
    monthly_limit_snapshot = Column(Integer, nullable=False, default=0)
    services_snapshot_json = Column(Text, nullable=False, default="{}")
    service_limits_snapshot_json = Column(Text, nullable=False, default="{}")
    start_at = Column(DateTime, nullable=True)
    end_at = Column(DateTime, nullable=True)
    billing_anchor_day = Column(Integer, nullable=True)  # day of month for billing
    current_cycle_start_at = Column(DateTime, nullable=True)
    current_cycle_end_at = Column(DateTime, nullable=True)
    auto_renew_enabled = Column(Boolean, nullable=False, default=False)
    approved_by_admin_id = Column(Integer, nullable=True)
    approved_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, nullable=False, default=_utcnow)
    updated_at = Column(DateTime, nullable=False, default=_utcnow, onupdate=_utcnow)

    # Relationships
    user = relationship("User", back_populates="subscriptions")
    plan = relationship("SubscriptionPlan")

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "user_id": self.user_id,
            "plan_id": self.plan_id,
            "status": self.status,
            "monthly_limit_snapshot": self.monthly_limit_snapshot,
            "services": _json_dict(self.services_snapshot_json),
            "service_limits": _json_dict(self.service_limits_snapshot_json),
            "start_at": self.start_at.isoformat() if self.start_at else None,
            "end_at": self.end_at.isoformat() if self.end_at else None,
            "current_cycle_start_at": self.current_cycle_start_at.isoformat() if self.current_cycle_start_at else None,
            "current_cycle_end_at": self.current_cycle_end_at.isoformat() if self.current_cycle_end_at else None,
            "auto_renew_enabled": self.auto_renew_enabled,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


# ═══════════════════════════════════════════════════════════════════════════════
# PAYMENT RECORDS
# ═══════════════════════════════════════════════════════════════════════════════

class PaymentRecord(Base):
    __tablename__ = "payment_records"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    subscription_id = Column(Integer, ForeignKey("user_subscriptions.id"), nullable=True)
    plan_id = Column(Integer, ForeignKey("subscription_plans.id"), nullable=True)
    telegram_user_id = Column(String(64), nullable=True)  # for easier admin lookup
    payment_method = Column(String(32), nullable=False, default="upi")
    amount = Column(Integer, nullable=False, default=0)
    currency = Column(String(3), nullable=False, default="INR")
    payment_ref = Column(String(255), nullable=True)  # generated payment reference/note
    upi_id_used = Column(String(255), nullable=True)  # UPI ID used at time of request
    payee_name_used = Column(String(255), nullable=True)  # payee name at time of request
    upi_reference = Column(String(255), nullable=True)  # user-provided UPI ref
    payer_name = Column(String(255), nullable=True)
    payment_screenshot_path = Column(String(512), nullable=True)
    payment_note = Column(Text, default="")
    # OCR extracted fields
    ocr_matched = Column(Boolean, nullable=True)  # True if OCR-extracted ref matches expected payment_ref
    ocr_extracted_ref = Column(String(255), nullable=True)  # Raw text extracted from screenshot OCR
    ocr_extracted_amount = Column(String(64), nullable=True)  # OCR extracted amount
    ocr_extracted_date = Column(String(64), nullable=True)  # OCR extracted date/time
    ocr_extracted_payer = Column(String(255), nullable=True)  # OCR extracted payer info
    status = Column(
        String(32),
        nullable=False,
        default="pending_payment",
        # Values: pending_payment, screenshot_required, screenshot_submitted,
        #   ocr_processing, ocr_matched, ocr_mismatch, ready_for_admin_approval,
        #   approved, rejected, expired
    )
    submitted_at = Column(DateTime, nullable=True)
    expires_at = Column(DateTime, nullable=True)  # payment request expiry
    verified_by_admin_id = Column(Integer, nullable=True)
    verified_at = Column(DateTime, nullable=True)
    rejection_reason = Column(Text, default="")
    created_at = Column(DateTime, nullable=False, default=_utcnow)
    updated_at = Column(DateTime, nullable=False, default=_utcnow, onupdate=_utcnow)

    # Relationships
    user = relationship("User", back_populates="payments")
    plan = relationship("SubscriptionPlan")

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "user_id": self.user_id,
            "subscription_id": self.subscription_id,
            "plan_id": self.plan_id,
            "telegram_user_id": self.telegram_user_id,
            "payment_method": self.payment_method,
            "amount": self.amount,
            "currency": self.currency,
            "payment_ref": self.payment_ref,
            "upi_id_used": self.upi_id_used,
            "payee_name_used": self.payee_name_used,
            "upi_reference": self.upi_reference,
            "payer_name": self.payer_name,
            "payment_screenshot_path": self.payment_screenshot_path,
            "payment_note": self.payment_note,
            "ocr_matched": self.ocr_matched,
            "ocr_extracted_ref": self.ocr_extracted_ref,
            "ocr_extracted_amount": self.ocr_extracted_amount,
            "ocr_extracted_date": self.ocr_extracted_date,
            "ocr_extracted_payer": self.ocr_extracted_payer,
            "status": self.status,
            "submitted_at": self.submitted_at.isoformat() if self.submitted_at else None,
            "expires_at": self.expires_at.isoformat() if self.expires_at else None,
            "verified_at": self.verified_at.isoformat() if self.verified_at else None,
            "rejection_reason": self.rejection_reason,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


# ═══════════════════════════════════════════════════════════════════════════════
# USER API KEYS (user-linked, extends existing api_keys concept)
# ═══════════════════════════════════════════════════════════════════════════════

class UserApiKey(Base):
    __tablename__ = "user_api_keys"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    key_hash = Column(String(255), unique=True, nullable=False)
    key_prefix_display = Column(String(16), nullable=False, default="")
    status = Column(
        String(32),
        nullable=False,
        default="active",
        # Values: active, revoked, expired, rotated
    )
    key_version = Column(Integer, nullable=False, default=1)
    issued_at = Column(DateTime, nullable=False, default=_utcnow)
    expires_at = Column(DateTime, nullable=True)
    last_used_at = Column(DateTime, nullable=True)
    usage_count = Column(Integer, nullable=False, default=0)
    revoked_at = Column(DateTime, nullable=True)
    revoked_reason = Column(String(255), default="")
    rotated_from_key_id = Column(Integer, nullable=True)
    created_by_admin_id = Column(Integer, nullable=True)

    # Relationships
    user = relationship("User", back_populates="api_keys")
    devices = relationship("UserApiKeyDevice", back_populates="api_key", lazy="dynamic")

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "user_id": self.user_id,
            "key_prefix_display": self.key_prefix_display,
            "status": self.status,
            "key_version": self.key_version,
            "issued_at": self.issued_at.isoformat() if self.issued_at else None,
            "expires_at": self.expires_at.isoformat() if self.expires_at else None,
            "last_used_at": self.last_used_at.isoformat() if self.last_used_at else None,
            "usage_count": self.usage_count,
            "revoked_at": self.revoked_at.isoformat() if self.revoked_at else None,
        }


# ═══════════════════════════════════════════════════════════════════════════════
# API KEY DEVICES
# ═══════════════════════════════════════════════════════════════════════════════

class UserApiKeyDevice(Base):
    __tablename__ = "user_api_key_devices"

    id = Column(Integer, primary_key=True, autoincrement=True)
    api_key_id = Column(Integer, ForeignKey("user_api_keys.id"), nullable=False, index=True)
    device_fingerprint = Column(String(255), nullable=False)
    device_name = Column(String(255), default="")
    user_agent = Column(String(512), default="")
    first_seen_at = Column(DateTime, nullable=False, default=_utcnow)
    last_seen_at = Column(DateTime, nullable=False, default=_utcnow)
    status = Column(
        String(32),
        nullable=False,
        default="active",
        # Values: active, replaced, blocked
    )

    __table_args__ = (
        UniqueConstraint("api_key_id", "device_fingerprint", name="uq_key_device"),
    )

    # Relationships
    api_key = relationship("UserApiKey", back_populates="devices")


# ═══════════════════════════════════════════════════════════════════════════════
# USAGE CYCLES
# ═══════════════════════════════════════════════════════════════════════════════

class UsageCycle(Base):
    __tablename__ = "usage_cycles"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    subscription_id = Column(Integer, ForeignKey("user_subscriptions.id"), nullable=False)
    cycle_start_at = Column(DateTime, nullable=False)
    cycle_end_at = Column(DateTime, nullable=False)
    monthly_limit = Column(Integer, nullable=False, default=0)
    used_count = Column(Integer, nullable=False, default=0)
    blocked_at_limit = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime, nullable=False, default=_utcnow)
    updated_at = Column(DateTime, nullable=False, default=_utcnow, onupdate=_utcnow)


# ═══════════════════════════════════════════════════════════════════════════════
# AUDIT LOGS
# ═══════════════════════════════════════════════════════════════════════════════

class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    actor_type = Column(String(32), nullable=False)  # admin, system, bot, user
    actor_id = Column(Integer, nullable=True)
    action = Column(String(128), nullable=False)
    target_type = Column(String(64), nullable=True)
    target_id = Column(Integer, nullable=True)
    before_json = Column(Text, nullable=True)
    after_json = Column(Text, nullable=True)
    ip_address = Column(String(45), nullable=True)
    created_at = Column(DateTime, nullable=False, default=_utcnow)


# =============================================================================
# LEGACY SETTINGS TABLES
# =============================================================================

class PlatformSettingRecord(Base):
    __tablename__ = "platform_settings"

    key = Column(String(255), primary_key=True)
    value = Column(Text, nullable=False, default="")
    description = Column(Text, nullable=True)
    updated_at = Column(String(64), nullable=False)


class AccessControlRecord(Base):
    __tablename__ = "access_control"

    key = Column(String(255), primary_key=True)
    value = Column(Text, nullable=False)


class AllowedDomainRecord(Base):
    __tablename__ = "allowed_domains"

    domain = Column(String(255), primary_key=True)


# ═══════════════════════════════════════════════════════════════════════════════
# REQUEST JOBS (for worker queue)
# ═══════════════════════════════════════════════════════════════════════════════

# =============================================================================
# LEGACY API KEY TABLES
# =============================================================================

class ApiKeyRecord(Base):
    __tablename__ = "api_keys"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(255), nullable=False)
    key_hash = Column(String(255), unique=True, nullable=False)
    enabled = Column(Integer, nullable=False, default=1)
    all_domains = Column(Integer, nullable=False, default=1)
    created_at = Column(String(64), nullable=False)
    expires_at = Column(String(64), nullable=True)
    revoked_at = Column(String(64), nullable=True)
    key_type = Column(String(32), nullable=False, default="user")
    plan_name = Column(String(255), nullable=False, default="Standard")
    mobile = Column(String(64), nullable=False, default="")
    telegram_id = Column(String(64), nullable=False, default="")
    services_json = Column(Text, nullable=False, default='{"autofill":true,"captcha":true,"stall":true,"solver":true,"custom":false}')


class ApiKeyAllowedDomainRecord(Base):
    __tablename__ = "api_key_allowed_domains"

    key_id = Column(Integer, primary_key=True)
    domain = Column(String(255), primary_key=True)


class ApiKeyRateLimitRecord(Base):
    __tablename__ = "api_key_rate_limits"

    key_id = Column(Integer, primary_key=True)
    requests_per_minute = Column(Integer, nullable=False)
    burst = Column(Integer, nullable=False, default=0)


class ApiKeyDeviceBindingRecord(Base):
    __tablename__ = "api_key_device_bindings"

    key_id = Column(Integer, primary_key=True)
    device_id = Column(String(255), nullable=False)
    user_agent = Column(String(512), nullable=True)
    first_seen_at = Column(String(64), nullable=False)
    last_seen_at = Column(String(64), nullable=False)


class UsageEventRecord(Base):
    __tablename__ = "usage_events"

    id = Column(Integer, primary_key=True, autoincrement=True)
    key_id = Column(Integer, nullable=False, index=True)
    task_type = Column(String(64), nullable=False)
    status = Column(String(32), nullable=False)
    processing_ms = Column(Integer, nullable=False)
    model_used = Column(String(255), nullable=True)
    domain = Column(String(255), nullable=True)
    ip = Column(String(45), nullable=True)
    created_at = Column(String(64), nullable=False)


# =============================================================================
# LEGACY MODEL ROUTING TABLES
# =============================================================================

class ModelRouteRecord(Base):
    __tablename__ = "model_routes"

    domain = Column(String(255), primary_key=True)
    ai_model_filename = Column(String(512), nullable=False)


class ModelRegistryRecord(Base):
    __tablename__ = "model_registry"

    id = Column(Integer, primary_key=True, autoincrement=True)
    ai_model_name = Column(String(255), nullable=False)
    version = Column(String(64), nullable=False)
    task_type = Column(String(64), nullable=False)
    ai_runtime = Column(String(64), nullable=False, default="onnx")
    ai_model_filename = Column(String(512), unique=True, nullable=False)
    status = Column(String(32), nullable=False, default="active")
    lifecycle_state = Column(String(32), nullable=False, default="production")
    notes = Column(Text, nullable=True)
    created_at = Column(String(64), nullable=False)
    updated_at = Column(String(64), nullable=False)


class FieldMappingRecord(Base):
    __tablename__ = "field_mappings"

    id = Column(Integer, primary_key=True, autoincrement=True)
    domain = Column(String(255), nullable=False)
    field_name = Column(String(255), nullable=False)
    task_type = Column(String(64), nullable=False)
    source_data_type = Column(String(64), nullable=False, default="image")
    source_selector = Column(Text, nullable=False, default="")
    target_data_type = Column(String(64), nullable=False, default="text")
    target_selector = Column(Text, nullable=False, default="")
    ai_model_id = Column(Integer, nullable=False)
    created_at = Column(String(64), nullable=False)

    __table_args__ = (
        UniqueConstraint("domain", "field_name", "task_type", name="uq_field_mapping_key"),
    )


class FieldMappingProposalRecord(Base):
    __tablename__ = "field_mapping_proposals"

    id = Column(Integer, primary_key=True, autoincrement=True)
    domain = Column(String(255), nullable=False)
    task_type = Column(String(64), nullable=False)
    source_data_type = Column(String(64), nullable=False)
    source_selector = Column(Text, nullable=False)
    target_data_type = Column(String(64), nullable=False)
    target_selector = Column(Text, nullable=False)
    proposed_field_name = Column(String(255), nullable=False)
    reported_by = Column(Integer, nullable=False)
    status = Column(String(32), nullable=False, default="pending")
    created_at = Column(String(64), nullable=False)


class ModelLifecycleEventRecord(Base):
    __tablename__ = "model_lifecycle_events"

    id = Column(Integer, primary_key=True, autoincrement=True)
    ai_model_id = Column(Integer, nullable=False)
    from_state = Column(String(32), nullable=True)
    to_state = Column(String(32), nullable=False)
    reason = Column(Text, nullable=True)
    changed_by = Column(Integer, nullable=True)
    created_at = Column(String(64), nullable=False)


# =============================================================================
# LEGACY AUTOFILL AND LOCATOR TABLES
# =============================================================================

class AutofillRuleProposalRecord(Base):
    __tablename__ = "autofill_rule_proposals"

    id = Column(Integer, primary_key=True, autoincrement=True)
    idempotency_key = Column(String(255), unique=True, nullable=True)
    device_id = Column(String(255), nullable=True)
    api_key_id = Column(Integer, nullable=True)
    status = Column(String(32), nullable=False, default="pending")
    reviewed_by = Column(String(255), nullable=True)
    reviewed_at = Column(String(64), nullable=True)
    submitted_at = Column(String(64), nullable=True)
    rule_json = Column(Text, nullable=False)
    approved_rule_id = Column(String(255), nullable=True)
    created_at = Column(String(64), nullable=False)


class LocatorRecord(Base):
    __tablename__ = "locators"

    id = Column(Integer, primary_key=True, autoincrement=True)
    domain = Column(String(255), nullable=False)
    image_selector = Column(Text, nullable=False)
    input_selector = Column(Text, nullable=False)
    status = Column(String(32), nullable=False, default="pending")
    created_at = Column(String(64), nullable=False)


# =============================================================================
# LEGACY TRAINING TABLES
# =============================================================================

class RetrainSampleRecord(Base):
    __tablename__ = "retrain_samples"

    id = Column(Integer, primary_key=True, autoincrement=True)
    domain = Column(String(255), nullable=False)
    image_path = Column(String(1024), nullable=False)
    task_type = Column(String(64), nullable=False, default="image")
    field_name = Column(String(255), nullable=True)
    reported_by = Column(Integer, nullable=False)
    status = Column(String(32), nullable=False, default="queued")
    label_text = Column(Text, nullable=True)
    labeled_by = Column(Integer, nullable=True)
    labeled_at = Column(String(64), nullable=True)
    consumed_by_job_id = Column(Integer, nullable=True)
    created_at = Column(String(64), nullable=False)


class RetrainJobRecord(Base):
    __tablename__ = "retrain_jobs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    status = Column(String(32), nullable=False, default="queued")
    scheduled_for = Column(String(64), nullable=False)
    started_at = Column(String(64), nullable=True)
    finished_at = Column(String(64), nullable=True)
    requested_by = Column(Integer, nullable=True)
    min_samples = Column(Integer, nullable=False, default=20)
    notes = Column(Text, nullable=True)
    error_message = Column(Text, nullable=True)
    produced_ai_model_id = Column(Integer, nullable=True)
    total_samples = Column(Integer, nullable=False, default=0)


class FailedPayloadLabelRecord(Base):
    __tablename__ = "failed_payload_labels"

    id = Column(Integer, primary_key=True, autoincrement=True)
    filename = Column(String(512), unique=True, nullable=False)
    domain = Column(String(255), nullable=False)
    ai_guess = Column(Text, nullable=True)
    corrected_text = Column(Text, nullable=False)
    updated_at = Column(String(64), nullable=False)


class ActiveLearningRecord(Base):
    __tablename__ = "active_learning"

    id = Column(Integer, primary_key=True, autoincrement=True)
    domain = Column(String(255), nullable=False)
    image_path = Column(String(1024), nullable=False)
    reported_by = Column(Integer, nullable=False)
    created_at = Column(String(64), nullable=False)


class RequestJob(Base):
    __tablename__ = "request_jobs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    api_key_id = Column(Integer, nullable=True)
    request_id = Column(String(64), unique=True, nullable=True)
    job_type = Column(String(64), nullable=False)
    priority = Column(Integer, nullable=False, default=0)
    status = Column(
        String(32),
        nullable=False,
        default="queued",
        # Values: queued, running, done, failed, cancelled
    )
    payload_ref = Column(String(512), nullable=True)
    result_ref = Column(String(512), nullable=True)
    attempt_count = Column(Integer, nullable=False, default=0)
    error_message = Column(Text, default="")
    queued_at = Column(DateTime, nullable=False, default=_utcnow)
    started_at = Column(DateTime, nullable=True)
    finished_at = Column(DateTime, nullable=True)


# =============================================================================
# MCQ LEARNING TABLES
# =============================================================================

class ExamAttemptRecord(Base):
    __tablename__ = "exam_attempts"

    id = Column(Integer, primary_key=True, autoincrement=True)
    question_hash = Column(String(255), nullable=False, index=True)
    selected_option = Column(Integer, nullable=False)
    was_correct = Column(Integer, nullable=False)
    method = Column(String(64), nullable=True)
    processing_ms = Column(Integer, nullable=False, default=0)
    domain = Column(String(255), nullable=True)
    question_num = Column(Integer, nullable=True)
    created_at = Column(String(64), nullable=False)


class ExamLearnedRecord(Base):
    __tablename__ = "exam_learned"

    id = Column(Integer, primary_key=True, autoincrement=True)
    question_hash = Column(String(255), unique=True, nullable=False, index=True)
    question_phash = Column(String(64), nullable=False, default="", index=True)
    question_text = Column(Text, default="")
    option_1 = Column(Text, default="")
    option_2 = Column(Text, default="")
    option_3 = Column(Text, default="")
    option_4 = Column(Text, default="")
    correct_option = Column(Integer, nullable=False)
    correct_option_hash = Column(String(255), nullable=False, default="")
    correct_option_phash = Column(String(64), nullable=False, default="")
    correct_option_text = Column(Text, nullable=False, default="")
    confidence = Column(Float, nullable=False, default=0.8)
    seen_count = Column(Integer, nullable=False, default=1)
    first_seen = Column(String(64), nullable=False)
    last_seen = Column(String(64), nullable=False)
    source = Column(String(64), nullable=False, default="exam_feedback")
    learning_mode = Column(String(64), nullable=False, default="hash_based")
    ocr_quality = Column(String(64), nullable=False, default="unverified")
    ocr_preview_unreliable = Column(Integer, nullable=False, default=1)
    verified_count = Column(Integer, nullable=False, default=0)
    wrong_count = Column(Integer, nullable=False, default=0)
    last_verified_at = Column(String(64), nullable=True)
    status = Column(String(32), nullable=False, default="training")


# ═══════════════════════════════════════════════════════════════════════════════
# BACKUP RUNS
# ═══════════════════════════════════════════════════════════════════════════════

class BackupRun(Base):
    __tablename__ = "backup_runs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    backup_type = Column(String(32), nullable=False)  # postgres_dump
    status = Column(String(32), nullable=False, default="running")
    storage_target = Column(String(512), nullable=True)
    started_at = Column(DateTime, nullable=False, default=_utcnow)
    finished_at = Column(DateTime, nullable=True)
    file_path_or_uri = Column(String(1024), nullable=True)
    filename = Column(String(512), nullable=True)
    file_size_bytes = Column(Integer, nullable=True)
    encrypted = Column(Boolean, nullable=False, default=False)
    telegram_enabled = Column(Boolean, nullable=False, default=False)
    telegram_status = Column(String(64), nullable=True)
    telegram_chat_id = Column(String(128), nullable=True)
    telegram_message_id = Column(String(128), nullable=True)
    rclone_enabled = Column(Boolean, nullable=False, default=False)
    rclone_status = Column(String(64), nullable=True)
    rclone_destination = Column(String(512), nullable=True)
    trigger_type = Column(String(32), nullable=False, default="manual")
    schedule_name = Column(String(128), nullable=True)
    next_run_at = Column(DateTime, nullable=True)
    triggered_by = Column(String(128), nullable=True)
    checksum = Column(String(128), nullable=True)
    error_summary = Column(Text, nullable=True)
    error_message = Column(Text, default="")
