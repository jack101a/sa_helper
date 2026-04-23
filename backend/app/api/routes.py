"""API routes — Unified Platform (captcha + exam + autofill)."""

from __future__ import annotations

import base64
import logging
import time
import uuid
from collections import deque
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import APIRouter, HTTPException, Request

from app.core.security import is_valid_base64
from app.models.schemas import (
    AutofillFillRequest,
    AutofillFillResponse,
    AutofillProposeRequest,
    ExamSolveRequest,
    ExamSolveResponse,
    FieldMappingProposeRequest,
    KeyCreateRequest,
    KeyCreateResponse,
    KeyRevokeRequest,
    LocatorProposeRequest,
    ReportRequest,
    SolveRequest,
    SolveResponse,
    VerifyResponse,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/v1", tags=["v1"])

_REPORT_WINDOW_SECONDS  = 60
_REPORT_MAX_PER_WINDOW  = 20
_report_buckets: dict[tuple[int, str], deque[float]] = {}
_PROJECT_ROOT  = Path(__file__).resolve().parents[3]
_DATASETS_DIR  = (_PROJECT_ROOT / "backend" / "datasets").resolve()


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


def _allow_report(key_id: int, domain: str) -> bool:
    now = time.monotonic()
    bucket_key = (key_id, domain)
    q = _report_buckets.setdefault(bucket_key, deque())
    while q and (now - q[0]) > _REPORT_WINDOW_SECONDS:
        q.popleft()
    if len(q) >= _REPORT_MAX_PER_WINDOW:
        return False
    q.append(now)
    return True


# ═══════════════════════════════════════════════════════════════════════════════
# SERVICE 1 — TEXT CAPTCHA  (/v1/solve, /v1/report)
# ═══════════════════════════════════════════════════════════════════════════════

@router.post("/solve", response_model=SolveResponse)
async def solve(request: Request, payload: SolveRequest) -> SolveResponse:
    """Solve a text captcha image using the ONNX OCR model."""
    container     = request.app.state.container
    key_record    = request.state.api_key_record
    client_ip     = request.client.host if request.client else None
    normalized    = _normalize_domain(payload.domain)

    if normalized:
        if not container.db.get_global_access():
            if not container.db.is_domain_allowed(normalized):
                raise HTTPException(403, "Domain not allowed by server policy.")
        if not container.db.is_domain_allowed_for_key(int(key_record["id"]), normalized):
            raise HTTPException(403, "Domain not allowed for this API key.")

    if not is_valid_base64(payload.payload_base64):
        raise HTTPException(400, "payload_base64 invalid")

    try:
        solved = await container.solver_service.submit(
            task_type=payload.type,
            payload_base64=payload.payload_base64,
            mode=payload.mode,
            domain=normalized or None,
            field_name=payload.field_name,
        )
        container.usage_service.record(
            key_id=int(key_record["id"]),
            task_type=f"captcha:{payload.type}",
            status="ok",
            processing_ms=solved["processing_ms"],
            model_used=solved.get("model_used"),
            domain=normalized or None,
            ip=client_ip,
        )
        return SolveResponse(**solved)
    except Exception as error:
        container.usage_service.record(
            key_id=int(key_record["id"]),
            task_type=f"captcha:{payload.type}",
            status="error",
            processing_ms=0,
            model_used=None,
            domain=normalized or None,
            ip=client_ip,
        )
        logger.exception("captcha_solve_failed", extra={"context": {"error": str(error)}})
        raise HTTPException(500, "captcha solve failed") from error


@router.post("/report")
async def report(request: Request, payload: ReportRequest) -> dict:
    """Upload a failed captcha image for retraining."""
    container  = request.app.state.container
    key_record = request.state.api_key_record
    key_id     = int(key_record["id"])

    if not is_valid_base64(payload.payload_base64):
        raise HTTPException(400, "payload_base64 invalid")
    normalized = _normalize_domain(payload.domain)
    if not normalized:
        raise HTTPException(400, "domain invalid")
    if not _allow_report(key_id=key_id, domain=normalized):
        raise HTTPException(429, "report rate limit exceeded")

    _DATASETS_DIR.mkdir(parents=True, exist_ok=True)
    try:
        raw = payload.payload_base64
        if "," in raw and raw.startswith("data:"):
            raw = raw.split(",", 1)[1]
        binary   = base64.b64decode(raw)
        file_id  = uuid.uuid4().hex[:12]
        filename = f"{normalized}_{file_id}.png"
        filepath = _DATASETS_DIR / filename
        with filepath.open("wb") as f:
            f.write(binary)
        return {"status": "reported", "filename": filename}
    except Exception as error:
        logger.exception("report_failed", extra={"context": {"error": str(error)}})
        raise HTTPException(500, "report failed") from error


# ═══════════════════════════════════════════════════════════════════════════════
# SERVICE 2 — EXAM SOLVER  (/v1/exam/solve)
# ═══════════════════════════════════════════════════════════════════════════════

@router.post("/exam/solve", response_model=ExamSolveResponse)
async def exam_solve(request: Request, payload: ExamSolveRequest) -> ExamSolveResponse:
    """
    Solve an MCQ question from the Sarathi exam portal.
    Extension sends base64 question image + 4 option images.
    Backend runs hash → OCR → LLM pipeline and returns the option number.
    """
    container  = request.app.state.container
    key_record = request.state.api_key_record
    client_ip  = request.client.host if request.client else None
    normalized = _normalize_domain(payload.domain)

    try:
        result = await container.exam_service.solve(
            question_b64=payload.question_image_b64,
            option_b64s=payload.option_images_b64,
            domain=normalized or None,
        )
        container.usage_service.record(
            key_id=int(key_record["id"]),
            task_type="exam",
            status="ok" if result.get("option_number") else "no_match",
            processing_ms=result.get("processing_ms", 0),
            model_used=result.get("method"),
            domain=normalized or None,
            ip=client_ip,
        )
        return ExamSolveResponse(
            option_number=result.get("option_number"),
            answer_text=result.get("answer_text"),
            method=result.get("method", "none"),
            processing_ms=result.get("processing_ms", 0),
        )
    except Exception as error:
        container.usage_service.record(
            key_id=int(key_record["id"]),
            task_type="exam",
            status="error",
            processing_ms=0,
            model_used=None,
            domain=normalized or None,
            ip=client_ip,
        )
        logger.exception("exam_solve_failed", extra={"context": {"error": str(error)}})
        raise HTTPException(500, "exam solve failed") from error


# ═══════════════════════════════════════════════════════════════════════════════
# SERVICE 3 — AUTOFILL  (/v1/autofill/*)
# ═══════════════════════════════════════════════════════════════════════════════

@router.post("/autofill/fill", response_model=AutofillFillResponse)
async def autofill_fill(request: Request, payload: AutofillFillRequest) -> AutofillFillResponse:
    """
    Resolve form field selectors to fill values.
    profile_data is sent by the extension from local storage (not persisted here).
    """
    container  = request.app.state.container
    key_record = request.state.api_key_record
    client_ip  = request.client.host if request.client else None
    normalized = _normalize_domain(payload.domain)

    try:
        fields_raw = [{"selector": f.selector, "label": f.label} for f in payload.fields]
        fills = container.autofill_service.resolve_fill(
            domain=normalized,
            fields=fields_raw,
            profile_data=payload.profile_data,
        )
        container.usage_service.record(
            key_id=int(key_record["id"]),
            task_type="autofill",
            status="ok",
            processing_ms=0,
            model_used="rule_engine",
            domain=normalized or None,
            ip=client_ip,
        )
        return AutofillFillResponse(fills=fills, domain=normalized)
    except Exception as error:
        logger.exception("autofill_fill_failed", extra={"context": {"error": str(error)}})
        raise HTTPException(500, "autofill fill failed") from error


@router.get("/autofill/routes")
async def autofill_routes(request: Request) -> dict:
    """Return all approved field mapping routes for extension sync."""
    container = request.app.state.container
    return container.autofill_service.get_all_routes()


@router.get("/autofill/routes/{domain}")
async def autofill_domain_routes(request: Request, domain: str) -> dict:
    """Return field mapping routes for a specific domain."""
    container  = request.app.state.container
    normalized = _normalize_domain(domain)
    return container.autofill_service.get_field_routes(normalized)


@router.post("/autofill/propose")
async def autofill_propose(request: Request, payload: AutofillProposeRequest) -> dict:
    """Extension proposes a new field mapping for admin review."""
    container  = request.app.state.container
    key_record = request.state.api_key_record
    container.autofill_service.propose_rule(
        domain=payload.domain,
        task_type=payload.task_type,
        source_data_type=payload.source_data_type,
        source_selector=payload.source_selector,
        target_data_type=payload.target_data_type,
        target_selector=payload.target_selector,
        proposed_field_name=payload.proposed_field_name,
        reported_by=int(key_record["id"]),
    )
    return {"status": "proposed"}


# ═══════════════════════════════════════════════════════════════════════════════
# AUTH / USAGE / KEYS
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/auth/verify", response_model=VerifyResponse)
async def verify(request: Request) -> VerifyResponse:
    key_record = request.state.api_key_record
    return VerifyResponse(
        valid=True,
        key_name=str(key_record["name"]),
        expires_at=key_record["expires_at"],
    )


@router.get("/usage")
async def usage(request: Request) -> dict:
    container  = request.app.state.container
    key_record = request.state.api_key_record
    summary    = container.db.get_usage_summary(key_id=int(key_record["id"]))
    return {"key_name": key_record["name"], "usage": summary}


@router.post("/key/create", response_model=KeyCreateResponse)
async def create_key(request: Request, payload: KeyCreateRequest) -> KeyCreateResponse:
    container = request.app.state.container
    _key_id, plain, expires_at = container.key_service.create_key(
        name=payload.name,
        expiry_days=payload.expiry_days,
    )
    return KeyCreateResponse(api_key=plain, expires_at=expires_at)


@router.post("/key/revoke")
async def revoke_key(request: Request, payload: KeyRevokeRequest) -> dict:
    container = request.app.state.container
    if not container.key_service.revoke_key(payload.api_key):
        raise HTTPException(404, "key not found")
    return {"revoked": True}


@router.get("/locators")
async def get_locators(request: Request) -> dict:
    container = request.app.state.container
    return container.db.get_approved_locators()


@router.get("/field-mappings")
async def get_field_mappings(request: Request) -> dict:
    container  = request.app.state.container
    domain     = _normalize_domain(request.query_params.get("domain", ""))
    if not domain:
        return {}
    return container.db.get_domain_field_mappings(domain)


@router.get("/field-mappings/routes")
async def get_all_field_mapping_routes(request: Request) -> dict:
    container = request.app.state.container
    return container.db.get_all_domain_field_mappings()


@router.post("/locators/propose")
async def propose_locator(request: Request, payload: LocatorProposeRequest) -> dict:
    container = request.app.state.container
    container.db.propose_locator(payload.domain, payload.image_selector, payload.input_selector)
    return {"status": "proposed"}


@router.post("/field-mappings/propose")
async def propose_field_mapping(request: Request, payload: FieldMappingProposeRequest) -> dict:
    container  = request.app.state.container
    key_record = request.state.api_key_record
    container.db.propose_field_mapping(
        domain=payload.domain.strip(),
        task_type=payload.task_type,
        source_data_type=payload.source_data_type.strip(),
        source_selector=payload.source_selector.strip(),
        target_data_type=payload.target_data_type.strip(),
        target_selector=payload.target_selector.strip(),
        proposed_field_name=payload.proposed_field_name.strip(),
        reported_by=int(key_record["id"]),
    )
    return {"status": "proposed"}
