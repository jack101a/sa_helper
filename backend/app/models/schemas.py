"""Pydantic request/response schemas — Unified Platform."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


# ── Shared ────────────────────────────────────────────────────────────────────
TaskType  = Literal["image", "text"]   # "audio" removed (non-text captcha stripped)
ModelMode = Literal["fast", "accurate"]


# ── Captcha ───────────────────────────────────────────────────────────────────
class SolveRequest(BaseModel):
    """Text captcha solve payload."""
    type: TaskType
    payload_base64: str = Field(min_length=1)
    mode: ModelMode = "fast"
    domain: str | None = None
    field_name: str | None = Field(default=None, min_length=1)


class SolveResponse(BaseModel):
    result: str
    processing_ms: int
    cached: bool = False
    model_used: str | None = None


# ── Exam ──────────────────────────────────────────────────────────────────────
class ExamSolveRequest(BaseModel):
    """MCQ exam question solve payload."""
    question_image_b64: str = Field(min_length=10, description="Base64-encoded question image")
    option_images_b64: list[str] = Field(min_length=2, max_length=4, description="Base64-encoded option images")
    domain: str | None = None


class ExamSolveResponse(BaseModel):
    option_number: int | None
    answer_text: str | None
    method: str                   # "hash" | "ocr_db" | "llm" | "none"
    processing_ms: int
    train_only: bool = False
    candidate_option: int | None = None
    confidence: float | None = None
    verified_count: int | None = None
    verified_required: int | None = None
    phash_distance: int | None = None
    allow_random_fallback: bool = True


class ExamFeedbackRequest(BaseModel):
    """Feedback from extension after answer submission — for self-learning."""
    question_image_b64: str = Field(min_length=10)
    option_images_b64: list[str] = Field(min_length=2, max_length=4)
    selected_option: int = Field(ge=1, le=4)
    was_correct: bool
    method: str | None = None
    processing_ms: int = 0
    domain: str | None = None
    question_num: int | None = None


class ExamFeedbackResponse(BaseModel):
    recorded: bool
    learned: bool = False  # True if added/updated in exam_learned
    message: str = ""


# ── Autofill ──────────────────────────────────────────────────────────────────
class FieldDescriptor(BaseModel):
    selector: str = Field(min_length=1)
    label: str = ""


class AutofillFillRequest(BaseModel):
    """
    Extension sends page fields + its local profile data.
    Backend resolves selector→value mappings using rules.
    Profile data stays client-side for privacy (not stored on server).
    """
    domain: str = Field(min_length=3)
    fields: list[FieldDescriptor]
    profile_data: dict[str, str] = Field(default_factory=dict)


class AutofillFillResponse(BaseModel):
    fills: list[dict[str, str]]   # [{selector, value}, ...]
    domain: str


class AutofillProposeRequest(BaseModel):
    domain: str = Field(min_length=3)
    task_type: TaskType = "text"
    source_data_type: str = Field(min_length=1)
    source_selector: str = Field(min_length=1)
    target_data_type: str = Field(min_length=1)
    target_selector: str = Field(min_length=1)
    proposed_field_name: str = Field(min_length=1)


# ── Autofill Rule Proposals (V26 Engine) ──────────────────────────────────────
class AutofillRuleStepSelector(BaseModel):
    strategy: str
    id: str = ""
    name: str = ""
    css: str = ""


class AutofillRuleStep(BaseModel):
    order: int
    action: str
    value: Any = None
    selector: AutofillRuleStepSelector


class AutofillRuleSite(BaseModel):
    match_mode: str
    pattern: str


class AutofillRule(BaseModel):
    local_rule_id: str | None = None
    server_rule_id: str | None = None
    name: str | None = None
    status: str | None = None
    site: AutofillRuleSite
    profile_scope: str = "default"
    frame_path: str = "any"
    priority: int = 100
    steps: list[AutofillRuleStep]
    meta: dict[str, Any] = Field(default_factory=dict)


class AutofillRuleClient(BaseModel):
    extension_version: str
    schema_version: int
    device_id: str
    browser: str
    os: str


class AutofillRuleProposalRequest(BaseModel):
    idempotency_key: str = Field(min_length=5)
    submitted_at: str
    client: AutofillRuleClient
    rule: AutofillRule


class AutofillRuleSyncResponse(BaseModel):
    rules: list[AutofillRule]


# ── Auth / Keys ───────────────────────────────────────────────────────────────
class VerifyResponse(BaseModel):
    valid: bool
    key_name: str
    expires_at: str | None
    key_expires_at: str | None = None
    subscription_expires_at: str | None = None
    is_master: bool = False
    plan_name: str = "Standard"
    mobile: str = ""
    telegram_id: str = ""
    enabled_services: dict[str, bool] = Field(default_factory=dict)
    rate_limit: dict[str, int] | None = None


class KeyCreateRequest(BaseModel):
    name: str = Field(min_length=1)
    expiry_days: int | None = None


class KeyCreateResponse(BaseModel):
    api_key: str
    expires_at: str | None


class KeyRevokeRequest(BaseModel):
    api_key: str = Field(min_length=5)


# ── Reports ───────────────────────────────────────────────────────────────────
class ReportRequest(BaseModel):
    domain: str = Field(min_length=3)
    payload_base64: str = Field(min_length=1)


# ── Locators / Field Mapping (reused from tata_captcha) ──────────────────────
class LocatorProposeRequest(BaseModel):
    domain: str = Field(min_length=3)
    image_selector: str = Field(min_length=1)
    input_selector: str = Field(min_length=1)


class FieldMappingProposeRequest(BaseModel):
    domain: str = Field(min_length=3)
    task_type: TaskType
    source_data_type: str = Field(min_length=1)
    source_selector: str = Field(min_length=1)
    target_data_type: str = Field(min_length=1)
    target_selector: str = Field(min_length=1)
    proposed_field_name: str = Field(min_length=1)
