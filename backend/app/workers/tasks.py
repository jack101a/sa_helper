"""Phase 10 background task entry points."""

from __future__ import annotations

import asyncio
from threading import Lock
from typing import Any

from app.core.config import get_settings
from app.core.container import Container, build_container
from app.services.exam_feedback_service import process_exam_feedback
from app.workers.celery_app import celery_app

_container_lock = Lock()
_container: Container | None = None


def _get_container() -> Container:
    global _container
    if _container is None:
        with _container_lock:
            if _container is None:
                _container = build_container(get_settings())
    return _container


@celery_app.task(name="health.ping")
def ping() -> dict[str, str]:
    """Sanity task for worker health checks."""
    return {"status": "ok"}


@celery_app.task(name="maintenance.package_extension")
def package_extension_task() -> dict[str, Any]:
    """Package browser extension artifacts in worker context."""
    container = _get_container()
    ok = bool(container.extension_service.package_extension())
    return {
        "ok": ok,
        "output_dir": str(container.extension_service.output_dir),
    }


@celery_app.task(name="maintenance.full_backup")
def full_backup_task(
    telegram: bool | None = None,
    rclone: bool | None = None,
    trigger_type: str = "manual",
    triggered_by: str = "worker",
    schedule_name: str | None = None,
) -> dict[str, Any]:
    """Run full backup in worker context."""
    container = _get_container()
    return container.backup_service.run_backup_now(
        telegram=telegram,
        rclone=rclone,
        trigger_type=trigger_type,
        triggered_by=triggered_by,
        schedule_name=schedule_name,
    )


@celery_app.task(name="feedback.exam")
def exam_feedback_task(payload: dict[str, Any]) -> dict[str, Any]:
    """Record exam feedback and persist learned/offline data in worker context."""
    container = _get_container()
    return process_exam_feedback(container, payload)


@celery_app.task(name="solve.captcha")
def solve_captcha_task(
    payload_base64: str,
    mode: str = "captcha",
    domain: str | None = None,
    field_name: str | None = None,
    task_type: str = "image",
) -> dict[str, Any]:
    """Solve captcha in worker context using shared solver service logic."""
    container = _get_container()
    return asyncio.run(
        container.solver_service.solve_direct(
            task_type=task_type,
            payload_base64=payload_base64,
            mode=mode,
            domain=domain,
            field_name=field_name,
        )
    )


@celery_app.task(name="solve.exam")
def solve_exam_task(
    question_image_b64: str,
    options_image_b64_list: list[str],
    domain: str | None = None,
) -> dict[str, Any]:
    """Run exam solve in worker context."""
    container = _get_container()
    return asyncio.run(
        container.exam_service.solve(
            question_b64=question_image_b64,
            option_b64s=options_image_b64_list,
            domain=domain,
        )
    )
