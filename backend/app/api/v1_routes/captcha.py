"""Captcha solving endpoints."""

from __future__ import annotations

import base64
import logging
import uuid

from fastapi import APIRouter, HTTPException, Request

from app.core.database import Database
from app.core.security import is_valid_base64
from app.models.schemas import ReportRequest, SolveRequest, SolveResponse

from .utils import _DATASETS_DIR, _REPORT_MAX_BYTES, allow_report, ensure_service_allowed

logger = logging.getLogger(__name__)

router = APIRouter(tags=["v1"])


@router.post("/solve", response_model=SolveResponse)
async def solve(request: Request, payload: SolveRequest) -> SolveResponse:
    """Solve a text captcha image using the ONNX OCR model."""
    ensure_service_allowed(request, "captcha")
    container = request.app.state.container
    key_record = request.state.api_key_record
    client_ip = request.client.host if request.client else None
    normalized = Database._normalize_domain(payload.domain)

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
    except HTTPException:
        raise
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
    ensure_service_allowed(request, "captcha")
    container = request.app.state.container
    key_record = request.state.api_key_record
    key_id = int(key_record["id"])

    if not is_valid_base64(payload.payload_base64):
        raise HTTPException(400, "payload_base64 invalid")
    normalized = Database._normalize_domain(payload.domain)
    if not normalized:
        raise HTTPException(400, "domain invalid")
    if not allow_report(key_id=key_id, domain=normalized):
        raise HTTPException(429, "report rate limit exceeded")

    _DATASETS_DIR.mkdir(parents=True, exist_ok=True)
    try:
        raw = payload.payload_base64
        if "," in raw and raw.startswith("data:"):
            raw = raw.split(",", 1)[1]
        binary = base64.b64decode(raw)

        # Enforce upload size limit to prevent disk exhaustion
        if len(binary) > _REPORT_MAX_BYTES:
            raise HTTPException(413, f"Payload too large (max {_REPORT_MAX_BYTES // 1024} KB)")

        file_id = uuid.uuid4().hex[:12]
        filename = f"{normalized}_{file_id}.png"
        filepath = _DATASETS_DIR / filename
        with filepath.open("wb") as f:
            f.write(binary)
        return {"status": "reported", "filename": filename}
    except HTTPException:
        raise
    except Exception as error:
        logger.exception("report_failed", extra={"context": {"error": str(error)}})
        raise HTTPException(500, "report failed") from error
