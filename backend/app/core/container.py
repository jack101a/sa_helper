"""Dependency container — Unified Platform."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from app.core.config import Settings
from app.core.database import Database
from app.services.alert_service import AlertService
from app.services.autofill_service import AutofillService
from app.services.cache_service import CacheService
from app.services.exam_service import ExamService
from app.services.key_service import KeyService
from app.services.model_router import ModelRouter
from app.services.solver_service import SolverService
from app.services.usage_service import UsageService


@dataclass
class Container:
    """Holds all initialized app services."""

    settings: Settings
    db: Database
    key_service: KeyService
    usage_service: UsageService
    solver_service: SolverService     # text captcha ONNX
    exam_service: ExamService          # MCQ solver (config from DB)
    autofill_service: AutofillService  # form autofill
    alert_service: AlertService        # WhatsApp admin alerts (config from DB)


def build_container(settings: Settings) -> Container:
    """Initialize and wire all services."""

    db = Database(settings=settings)
    db.init()

    # Captcha solver (existing ONNX pipeline)
    model_router = ModelRouter(settings=settings, db=db)
    cache = CacheService(ttl_seconds=settings.queue.cache_ttl_seconds)
    solver = SolverService(
        workers=settings.queue.workers,
        max_pending_jobs=settings.queue.max_pending_jobs,
        model_router=model_router,
        cache=cache,
    )

    key_service   = KeyService(db=db, settings=settings)
    usage_service = UsageService(db=db)

    # Exam service — reads runtime config from DB (admin dashboard)
    data_dir     = (Path(__file__).resolve().parents[3] / "backend" / "app" / "data").resolve()
    exam_service = ExamService(db=db, data_dir=data_dir)

    # Autofill service
    autofill_service = AutofillService(db=db)

    # Alert service — reads phone/apikey/enabled from DB (admin dashboard)
    alert_service = AlertService(db=db)

    return Container(
        settings=settings,
        db=db,
        key_service=key_service,
        usage_service=usage_service,
        solver_service=solver,
        exam_service=exam_service,
        autofill_service=autofill_service,
        alert_service=alert_service,
    )
