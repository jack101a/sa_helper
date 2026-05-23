"""Exam solving and feedback endpoints."""

from __future__ import annotations

import logging

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request

from app.core.database import Database
from app.models.schemas import ExamFeedbackRequest, ExamFeedbackResponse, ExamSolveRequest, ExamSolveResponse

from .utils import ensure_service_allowed, export_learned_to_json_safe, save_exam_offline_dataset_safe

logger = logging.getLogger(__name__)

router = APIRouter(tags=["v1"])


def _exam_daily_limit(container) -> int:
    try:
        raw = container.db.get_setting("exam.workflow_daily_limit", "5")
        return max(1, int(raw))
    except Exception:
        return 5


def _current_user_id(request: Request) -> int | None:
    key_record = request.state.api_key_record
    if key_record.get("key_type") == "master":
        return None
    user_id = key_record.get("user_id")
    return int(user_id) if user_id else None


def _quota_response(request: Request) -> dict:
    ensure_service_allowed(request, "solver")
    user_id = _current_user_id(request)
    if user_id is None:
        return {"allowed": True, "quota_enforced": False}
    container = request.app.state.container
    result = container.usage_cycle_service.check_exam_workflow_quota(
        user_id,
        daily_limit=_exam_daily_limit(container),
    )
    if not result.get("allowed"):
        raise HTTPException(429, result.get("reason", "exam workflow quota exceeded"))
    return {"allowed": True, "quota_enforced": True, **result}


@router.post("/exam/workflow/start")
async def exam_workflow_start(request: Request, payload: dict | None = None) -> dict:
    """Check quota once before a mock/stall exam workflow starts."""
    return _quota_response(request)


@router.post("/exam/workflow/complete")
async def exam_workflow_complete(request: Request, payload: dict | None = None) -> dict:
    """Count one completed mock/stall exam workflow."""
    ensure_service_allowed(request, "solver")
    user_id = _current_user_id(request)
    if user_id is None:
        return {"allowed": True, "quota_enforced": False}

    body = payload or {}
    container = request.app.state.container
    result = container.usage_cycle_service.record_exam_workflow_complete(
        user_id,
        str(body.get("workflow_id") or ""),
        daily_limit=_exam_daily_limit(container),
        domain=Database._normalize_domain(body.get("domain")),
        question_count=int(body.get("question_count") or 0),
    )
    if not result.get("allowed"):
        raise HTTPException(429, result.get("reason", "exam workflow quota exceeded"))
    return {"allowed": True, "quota_enforced": True, **result}


@router.post("/exam/solve", response_model=ExamSolveResponse)
async def exam_solve(request: Request, payload: ExamSolveRequest) -> ExamSolveResponse:
    ensure_service_allowed(request, "solver")
    """
    Solve an MCQ question from the Sarathi exam portal.
    Extension sends base64 question image + 4 option images.
    Backend runs hash → OCR → LLM pipeline and returns the option number.
    """
    container = request.app.state.container
    key_record = request.state.api_key_record
    client_ip = request.client.host if request.client else None
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
            allow_random_fallback=bool(result.get("allow_random_fallback", True)),
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
async def exam_feedback(
    request: Request,
    payload: ExamFeedbackRequest,
    background_tasks: BackgroundTasks,
) -> ExamFeedbackResponse:
    ensure_service_allowed(request, "solver")
    """
    Receive per-question correctness feedback from the extension.
    When learning is enabled and answer was correct, the question is
    added to the self-learning database (exam_learned).
    """
    container = request.app.state.container
    key_record = request.state.api_key_record
    db = container.db

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
    opt_images: list[object | None] = []
    try:
        from app.services.exam_service import ExamService

        opt_texts = []
        opt_hashes = []
        opt_phashes = []
        for opt_b64 in payload.option_images_b64:
            try:
                opt_img = _b64_to_pil(opt_b64)
                opt_images.append(opt_img)
                opt_hashes.append(_djb2_hash(opt_img))
                opt_phashes.append(_phash(opt_img))
                opt_texts.append(ExamService._ocr_text_static(opt_img))
            except Exception:
                opt_images.append(None)
                opt_hashes.append("")
                opt_phashes.append("")
                opt_texts.append("")
        question_text = ExamService._ocr_text_static(q_img)
    except Exception as e:
        logger.warning("exam_feedback_ocr_failed", extra={"context": {"error": str(e)}})
        question_text = ""
        opt_texts = ["", "", "", ""]
        opt_hashes = ["", "", "", ""]
        opt_phashes = ["", "", "", ""]
        if not opt_images:
            opt_images = [None] * len(payload.option_images_b64)

    correct_index = int(payload.selected_option) - 1
    correct_option_text = opt_texts[correct_index] if 0 <= correct_index < len(opt_texts) else ""
    correct_option_hash = opt_hashes[correct_index] if 0 <= correct_index < len(opt_hashes) else ""
    correct_option_phash = opt_phashes[correct_index] if 0 <= correct_index < len(opt_phashes) else ""

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
        correct_option_hash=correct_option_hash,
        correct_option_phash=correct_option_phash,
        correct_option_text=correct_option_text,
        source="exam_feedback",
        learning_mode="hash_based",
        ocr_quality="unverified_preview",
        ocr_preview_unreliable=True,
    )
    # Hot-reload in-memory learned index so next solve benefits immediately
    container.exam_service._reload_learned_index()

    logger.info("exam_feedback_learned", extra={
        "context": {
            "hash": question_hash[:12],
            "phash": question_phash[:12],
            "action": result["action"],
            "confidence": result["confidence"],
            "option": payload.selected_option,
        }
    })

    background_tasks.add_task(
        save_exam_offline_dataset_safe,
        question_image=q_img,
        option_images=opt_images,
        question_hash=question_hash,
        question_phash=question_phash,
        question_text=question_text,
        option_texts=opt_texts,
        option_hashes=opt_hashes,
        option_phashes=opt_phashes,
        correct_option=payload.selected_option,
        correct_option_hash=correct_option_hash,
        correct_option_phash=correct_option_phash,
        correct_option_text=correct_option_text,
        domain=payload.domain,
        method=payload.method,
        question_num=payload.question_num,
        learn_result=result,
    )

    # Export learned questions to JSON (fire-and-forget)
    background_tasks.add_task(export_learned_to_json_safe, container)

    return ExamFeedbackResponse(
        recorded=True,
        learned=True,
        message=f"{result['action']} (confidence: {result['confidence']:.1f})",
    )
