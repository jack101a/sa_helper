"""API routes — Unified Platform (captcha + exam + autofill)."""

from __future__ import annotations

import base64
import json
import logging
import re
import time
import uuid
from collections import deque
from pathlib import Path
from urllib.parse import urlsplit
from app.core.paths import get_project_root

from fastapi import APIRouter, HTTPException, Request

from app.core.database import Database
from app.core.security import is_valid_base64
from app.core.userscript_utils import parse_userscript_meta
from app.models.schemas import (
    AutofillFillRequest,
    AutofillFillResponse,
    AutofillProposeRequest,
    AutofillRuleProposalRequest,
    AutofillRuleSyncResponse,
    AutofillRule,
    ExamFeedbackRequest,
    ExamFeedbackResponse,
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
# Maximum report upload size: 5 MB of raw binary (before base64 expansion ~3.75 MB)
_REPORT_MAX_BYTES       = 5 * 1024 * 1024
_PROJECT_ROOT  = get_project_root()
_DATASETS_DIR  = (_PROJECT_ROOT / "backend" / "datasets").resolve()

# Per-(key_id, domain) sliding-window deques for report rate limiting.
# Pruned periodically to prevent unbounded memory growth.
_report_buckets: dict[tuple[int, str], deque[float]] = {}
_REPORT_PRUNE_INTERVAL = 300  # seconds between prune passes
_last_prune: float = 0.0


def _ensure_master_key(request: Request) -> None:
    """Raise 403 if the current API key is not a master key."""
    key_record = request.state.api_key_record
    if not key_record or key_record.get("key_type") != "master":
        raise HTTPException(403, "Master key required for this administrative action.")


def _prune_report_buckets() -> None:
    """Remove expired entries from _report_buckets to prevent memory leaks."""
    global _last_prune
    now = time.monotonic()
    if now - _last_prune < _REPORT_PRUNE_INTERVAL:
        return
    _last_prune = now
    dead_keys = []
    for key, q in list(_report_buckets.items()):
        while q and (now - q[0]) > _REPORT_WINDOW_SECONDS:
            q.popleft()
        if not q:
            dead_keys.append(key)
    for key in dead_keys:
        _report_buckets.pop(key, None)


def _allow_report(key_id: int, domain: str) -> bool:
    _prune_report_buckets()
    now = time.monotonic()
    bucket_key = (key_id, domain)
    q = _report_buckets.setdefault(bucket_key, deque())
    while q and (now - q[0]) > _REPORT_WINDOW_SECONDS:
        q.popleft()
    if len(q) >= _REPORT_MAX_PER_WINDOW:
        return False
    q.append(now)
    return True


def _userscript_sync_status(meta: dict) -> str:
    diagnostics = meta.get("diagnostics") if isinstance(meta, dict) else {}
    errors = diagnostics.get("errors") if isinstance(diagnostics, dict) else []
    return "error" if errors else "ready"


# ═══════════════════════════════════════════════════════════════════════════════
# SERVICE 4 — USERSCRIPTS (/v1/userscripts)
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/userscripts/sync")
async def sync_userscripts(request: Request) -> dict:
    """
    Sync backend-managed userscripts to the extension.
    Source of truth:
    - Optional index file in data/userscripts or data/mappings
    - Fallback: all *.user.js files in the first populated source directory
    """
    root = get_project_root()
    candidate_dirs = [
        (root / "data" / "userscripts").resolve(),
        (root / "data" / "mappings").resolve(),
        (root / "backend" / "datasets" / "userscripts").resolve(),
    ]
    scripts_dir = next(
        (
            item for item in candidate_dirs
            if (item / "index.json").is_file() or any(item.glob("*.user.js"))
        ),
        candidate_dirs[0],
    )

    scripts_data: list[dict] = []
    index_path = scripts_dir / "index.json"

    if index_path.is_file():
        try:
            entries = json.loads(index_path.read_text(encoding="utf-8"))
            if not isinstance(entries, list):
                raise ValueError("index.json must be a JSON array")
            for entry in entries:
                if not isinstance(entry, dict):
                    continue
                file_name = str(entry.get("file", "")).strip()
                if not file_name:
                    continue
                try:
                    path = (scripts_dir / file_name).resolve()
                    if scripts_dir.resolve() not in path.parents or not path.is_file():
                        raise ValueError(f"Invalid userscript file: {file_name}")
                    code = path.read_text(encoding="utf-8")
                    parsed = parse_userscript_meta(code)
                    script_id = str(entry.get("id") or Path(file_name).stem.replace(".user", "")).strip()
                    scripts_data.append({
                        "id": script_id,
                        "name": str(entry.get("name") or parsed["name"] or script_id),
                        "version": str(entry.get("version") or parsed["version"]),
                        "description": str(entry.get("description") or parsed["description"]),
                        "sourceUrl": str(entry.get("sourceUrl") or entry.get("installUrl") or parsed["downloadURL"] or ""),
                        "enabled": bool(entry.get("enabled", True)),
                        "matches": entry.get("matches") if isinstance(entry.get("matches"), list) else parsed["matches"],
                        "includes": entry.get("includes") if isinstance(entry.get("includes"), list) else parsed["includes"],
                        "exclude": entry.get("exclude") if isinstance(entry.get("exclude"), list) else parsed["exclude"],
                        "excludeMatches": entry.get("excludeMatches") if isinstance(entry.get("excludeMatches"), list) else parsed["excludeMatches"],
                        "runAt": str(entry.get("runAt") or parsed["runAt"]),
                        "requires": entry.get("requires") if isinstance(entry.get("requires"), list) else parsed["requires"],
                        "resources": entry.get("resources") if isinstance(entry.get("resources"), list) else parsed["resources"],
                        "grants": entry.get("grants") if isinstance(entry.get("grants"), list) else parsed["grants"],
                        "connects": entry.get("connects") if isinstance(entry.get("connects"), list) else parsed["connects"],
                        "noframes": bool(entry.get("noframes", parsed["noframes"])),
                        "diagnostics": parsed.get("diagnostics", {"warnings": [], "errors": []}),
                        "syncStatus": _userscript_sync_status(parsed),
                        "updatedAt": int(path.stat().st_mtime),
                        "code": code,
                    })
                except Exception as e:
                    logger.exception("Failed userscript entry %s: %s", file_name, e)
        except Exception as e:
            logger.exception("Failed to parse userscripts index.json: %s", e)
    else:
        for filepath in scripts_dir.glob("*.user.js"):
            if not filepath.is_file():
                continue
            try:
                code = filepath.read_text(encoding="utf-8")
                parsed = parse_userscript_meta(code)
                script_id = filepath.stem.replace(".user", "")
                scripts_data.append({
                    "id": script_id,
                    "name": parsed["name"] or script_id,
                    "version": parsed["version"],
                    "description": parsed["description"],
                    "sourceUrl": parsed["downloadURL"],
                    "enabled": True,
                    "matches": parsed["matches"],
                    "includes": parsed["includes"],
                    "exclude": parsed["exclude"],
                    "excludeMatches": parsed["excludeMatches"],
                    "runAt": parsed["runAt"],
                    "requires": parsed["requires"],
                    "resources": parsed["resources"],
                    "grants": parsed["grants"],
                    "connects": parsed["connects"],
                    "noframes": parsed["noframes"],
                    "diagnostics": parsed.get("diagnostics", {"warnings": [], "errors": []}),
                    "syncStatus": _userscript_sync_status(parsed),
                    "updatedAt": int(filepath.stat().st_mtime),
                    "code": code,
                })
            except Exception as e:
                logger.exception("Failed to read userscript %s: %s", filepath.name, e)

    return {"scripts": scripts_data}


# ═══════════════════════════════════════════════════════════════════════════════
# SERVICE 1 — TEXT CAPTCHA  (/v1/solve, /v1/report)
# ═══════════════════════════════════════════════════════════════════════════════

@router.post("/solve", response_model=SolveResponse)
async def solve(request: Request, payload: SolveRequest) -> SolveResponse:
    """Solve a text captcha image using the ONNX OCR model."""
    container     = request.app.state.container
    key_record    = request.state.api_key_record
    client_ip     = request.client.host if request.client else None
    normalized    = Database._normalize_domain(payload.domain)

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
    container  = request.app.state.container
    key_record = request.state.api_key_record
    key_id     = int(key_record["id"])

    if not is_valid_base64(payload.payload_base64):
        raise HTTPException(400, "payload_base64 invalid")
    normalized = Database._normalize_domain(payload.domain)
    if not normalized:
        raise HTTPException(400, "domain invalid")
    if not _allow_report(key_id=key_id, domain=normalized):
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

        file_id  = uuid.uuid4().hex[:12]
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
    normalized = Database._normalize_domain(payload.domain)

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
            train_only=bool(result.get("train_only", False)),
            candidate_option=result.get("candidate_option"),
            confidence=result.get("confidence"),
            verified_count=result.get("verified_count"),
            phash_distance=result.get("phash_distance"),
        )
    except HTTPException:
        raise
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


@router.post("/exam/feedback", response_model=ExamFeedbackResponse)
async def exam_feedback(request: Request, payload: ExamFeedbackRequest) -> ExamFeedbackResponse:
    """
    Receive per-question correctness feedback from the extension.
    When learning is enabled and answer was correct, the question is
    added to the self-learning database (exam_learned).
    """
    container  = request.app.state.container
    key_record = request.state.api_key_record
    db         = container.db

    # Check if learning is enabled
    learning_enabled = db.get_setting("exam.learning_enabled", "true").lower() in ("true", "1", "yes", "on")
    if not learning_enabled:
        return ExamFeedbackResponse(recorded=False, learned=False, message="Learning is disabled")

    # Compute perceptual hash of the question image
    try:
        from app.services.exam_service import _b64_to_pil, _djb2_hash, _phash
        q_img = _b64_to_pil(payload.question_image_b64)
        question_hash = _djb2_hash(q_img)
        question_phash = _phash(q_img)
    except Exception as e:
        logger.warning("exam_feedback_hash_failed", extra={"context": {"error": str(e)}})
        return ExamFeedbackResponse(recorded=False, learned=False, message=f"Hash failed: {e}")

    # Record the attempt
    db.insert_exam_attempt(
        question_hash=question_hash,
        selected_option=payload.selected_option,
        was_correct=payload.was_correct,
        method=payload.method,
        processing_ms=payload.processing_ms,
        domain=payload.domain,
        question_num=payload.question_num,
    )

    # Only learn from correct answers
    if not payload.was_correct:
        penalty = None
        try:
            penalty = db.exam_learned.record_wrong(question_hash, selected_option=payload.selected_option)
        except Exception as e:
            logger.warning("exam_feedback_wrong_penalty_failed", extra={"context": {"error": str(e)}})
        msg = "Wrong answer - not learning"
        if penalty and penalty.get("action") == "penalized":
            msg = f"Wrong answer - learned row penalized (confidence: {penalty['confidence']:.1f})"
        return ExamFeedbackResponse(recorded=True, learned=False, message=msg)

    # OCR the question and options for text storage
    try:
        from app.services.exam_service import ExamService
        opt_texts = []
        for opt_b64 in payload.option_images_b64:
            try:
                opt_img = _b64_to_pil(opt_b64)
                opt_texts.append(ExamService._ocr_text_static(opt_img))
            except Exception:
                opt_texts.append("")
        question_text = ExamService._ocr_text_static(q_img)
    except Exception as e:
        logger.warning("exam_feedback_ocr_failed", extra={"context": {"error": str(e)}})
        question_text = ""
        opt_texts = ["", "", "", ""]

    # Upsert into learned database
    result = db.upsert_exam_learned(
        question_hash=question_hash,
        question_phash=question_phash,
        question_text=question_text,
        option_1=opt_texts[0] if len(opt_texts) > 0 else "",
        option_2=opt_texts[1] if len(opt_texts) > 1 else "",
        option_3=opt_texts[2] if len(opt_texts) > 2 else "",
        option_4=opt_texts[3] if len(opt_texts) > 3 else "",
        correct_option=payload.selected_option,
        source="exam_feedback",
        learning_mode="hash_based",
        ocr_quality="unverified_preview",
        ocr_preview_unreliable=True,
    )

    logger.info("exam_feedback_learned", extra={
        "context": {
            "hash": question_hash[:12],
            "phash": question_phash[:12],
            "action": result["action"],
            "confidence": result["confidence"],
            "option": payload.selected_option,
        }
    })

    # Export learned questions to JSON (fire-and-forget)
    try:
        container.exam_service.export_learned_to_json()
    except Exception as e:
        logger.warning("exam_feedback_export_failed", extra={"context": {"error": str(e)}})

    return ExamFeedbackResponse(
        recorded=True,
        learned=True,
        message=f"{result['action']} (confidence: {result['confidence']:.1f})",
    )


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
    normalized = Database._normalize_domain(payload.domain)

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
    except HTTPException:
        raise
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
    normalized = Database._normalize_domain(domain)
    return container.autofill_service.get_field_routes(normalized)


@router.post("/autofill/proposals")
async def autofill_rule_proposals(request: Request, payload: AutofillRuleProposalRequest) -> dict:
    """Extension submits a recorded rule (V26 engine) for admin review."""
    _ensure_master_key(request)
    container = request.app.state.container
    key_record = request.state.api_key_record

    rule_json = payload.rule.model_dump_json()

    proposal = container.db.submit_autofill_proposal(
        idempotency_key=payload.idempotency_key,
        device_id=payload.client.device_id,
        api_key_id=int(key_record["id"]),
        rule_json=rule_json,
        submitted_at=payload.submitted_at,
    )
    return {"status": "accepted", "proposal_id": proposal.get("id")}


@router.get("/autofill/sync", response_model=AutofillRuleSyncResponse)
async def autofill_sync(request: Request) -> AutofillRuleSyncResponse:
    """Extension downloads approved rules (V26 engine) for local playback."""
    container = request.app.state.container
    approved_rows = container.db.get_approved_autofill_rules()

    rules: list[AutofillRule] = []
    for row in approved_rows:
        try:
            rule_data = json.loads(row["rule_json"])
            rule_data["server_rule_id"] = row["approved_rule_id"]
            rules.append(AutofillRule(**rule_data))
        except Exception:
            logger.exception("failed_to_parse_approved_rule", extra={"context": {"id": row["id"]}})

    return AutofillRuleSyncResponse(rules=rules)


# ═══════════════════════════════════════════════════════════════════════════════
# SERVICE 1 — TEXT CAPTCHA  (/v1/solve, /v1/report)
# ═══════════════════════════════════════════════════════════════════════════════
# SERVICE 4 — AUTOMATION PAYLOADS
# ═══════════════════════════════════════════════════════════════════════════════

_AUTOMATION_SCRIPT_IDS = {"step3", "step4", "stall-flow"}


def _read_automation_script(step_id: str) -> str:
    script_path = _PROJECT_ROOT / "data" / "automation_scripts" / f"{step_id}.js"
    if not script_path.exists():
        logger.error("automation_script_not_found", extra={"context": {"path": str(script_path)}})
        raise HTTPException(404, f"Automation script for {step_id} not found")
    return script_path.read_text(encoding="utf-8")


def _compose_stall_flow_payload(step3_code: str, step4_code: str) -> str:
    step3_literal = json.dumps(step3_code)
    step4_literal = json.dumps(step4_code)
    return f"""
const __stallSleep = function(ms) {{
    return new Promise(resolve => setTimeout(resolve, ms));
}};
const __stallAjaxActive = function() {{
    try {{
        if (typeof window.$ !== 'undefined' && Number.isFinite(Number(window.$.active))) {{
            return Number(window.$.active);
        }}
    }} catch (_) {{}}
    return 0;
}};
const __stallWaitForAjaxIdle = async function(label, timeoutMs, beforeActive) {{
    const startedAt = Date.now();
    let sawBusy = false;
    while (Date.now() - startedAt < timeoutMs) {{
        const active = __stallAjaxActive();
        if (active > beforeActive || active > 0) sawBusy = true;
        const elapsed = Date.now() - startedAt;
        if (elapsed >= 1000 && ((sawBusy && active === 0) || (!sawBusy && elapsed >= 2500))) return;
        await __stallSleep(250);
    }}
    console.warn('[STALL Flow] AJAX wait timed out for ' + label);
}};
const __stallRunPayload = async function(label, code) {{
    console.log('[STALL Flow] Running ' + label);
    const beforeActive = __stallAjaxActive();
    const runner = new Function(code);
    const result = runner();
    if (result && typeof result.then === 'function') await result;
    await __stallSleep(500);
    await __stallWaitForAjaxIdle(label, 15000, beforeActive);
}};
await __stallRunPayload('step3', {step3_literal});
await __stallSleep(5000);
await __stallRunPayload('step4', {step4_literal});
return {{ ok: true, step: 'stall-flow' }};
""".strip()


@router.get("/automation/payload/{step_id}")
async def get_automation_payload(request: Request, step_id: str) -> dict:
    """Serve stateless automation scripts for STALL payloads."""
    # Key validation is already handled by AuthMiddleware.
    # We only allow specific step_ids to prevent arbitrary file reading.
    if step_id not in _AUTOMATION_SCRIPT_IDS:
        raise HTTPException(400, "Invalid step_id")

    try:
        if step_id == "stall-flow":
            payload = _compose_stall_flow_payload(
                step3_code=_read_automation_script("step3"),
                step4_code=_read_automation_script("step4"),
            )
        else:
            payload = _read_automation_script(step_id)
        return {"step_id": step_id, "payload": payload}
    except HTTPException:
        raise
    except Exception as error:
        logger.exception("automation_payload_failed", extra={"context": {"error": str(error)}})
        raise HTTPException(500, "Failed to read automation payload")


# ═══════════════════════════════════════════════════════════════════════════════
# AUTH / USAGE / KEYS
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/auth/verify", response_model=VerifyResponse)
async def verify(request: Request) -> VerifyResponse:
    key_record = request.state.api_key_record
    container  = request.app.state.container
    key_hash   = key_record.get("key_hash", "")
    is_master  = container.db.is_master_key_hash(key_hash)
    return VerifyResponse(
        valid=True,
        key_name=str(key_record["name"]),
        expires_at=key_record["expires_at"],
        is_master=is_master,
    )


@router.get("/usage")
async def usage(request: Request) -> dict:
    container  = request.app.state.container
    key_record = request.state.api_key_record
    summary    = container.db.get_usage_summary(key_id=int(key_record["id"]))
    return {"key_name": key_record["name"], "usage": summary}


@router.post("/key/create", response_model=KeyCreateResponse)
async def create_key(request: Request, payload: KeyCreateRequest) -> KeyCreateResponse:
    _ensure_master_key(request)
    container = request.app.state.container
    _key_id, plain, expires_at = container.key_service.create_key(
        name=payload.name,
        expiry_days=payload.expiry_days,
    )
    return KeyCreateResponse(api_key=plain, expires_at=expires_at)


@router.post("/key/revoke")
async def revoke_key(request: Request, payload: KeyRevokeRequest) -> dict:
    _ensure_master_key(request)
    container = request.app.state.container
    if not container.key_service.revoke_key(payload.api_key):
        raise HTTPException(404, "key not found")
    return {"revoked": True}


@router.get("/locators")
async def get_locators(request: Request) -> dict:
    # NOTE: This endpoint intentionally has no API-key auth — locators are
    # public metadata that the extension reads before authenticating.
    container = request.app.state.container
    return container.db.get_approved_locators()


@router.get("/field-mappings")
async def get_field_mappings(request: Request) -> dict:
    container  = request.app.state.container
    domain     = Database._normalize_domain(request.query_params.get("domain", ""))
    if not domain:
        return {}
    return container.db.get_domain_field_mappings(domain)


@router.get("/field-mappings/routes")
async def get_all_field_mapping_routes(request: Request) -> dict:
    container = request.app.state.container
    return container.db.get_all_domain_field_mappings()


@router.post("/locators/propose")
async def propose_locator(request: Request, payload: LocatorProposeRequest) -> dict:
    _ensure_master_key(request)
    container = request.app.state.container
    container.db.propose_locator(payload.domain, payload.image_selector, payload.input_selector)
    return {"status": "proposed"}


@router.post("/field-mappings/propose")
async def propose_field_mapping(request: Request, payload: FieldMappingProposeRequest) -> dict:
    _ensure_master_key(request)
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
