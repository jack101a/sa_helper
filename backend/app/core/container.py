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
from app.services.retrain_service import RetrainService
from app.services.solver_service import SolverService
from app.services.usage_service import UsageService


@dataclass
class Container:
    """Holds all initialized app services."""

    settings: Settings
    db: Database
    key_service: KeyService
    usage_service: UsageService
    solver_service: SolverService    # text captcha ONNX
    exam_service: ExamService         # MCQ solver
    autofill_service: AutofillService # form autofill
    alert_service: AlertService       # WhatsApp admin alerts
    retrain_service: RetrainService


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

    # Key & usage services
    key_service     = KeyService(db=db, settings=settings)
    usage_service   = UsageService(db=db)

    # Exam service
    data_dir = Path(__file__).resolve().parents[3] / "backend" / "app" / "data"
    exam_service = ExamService(settings_exam=settings.exam, data_dir=data_dir)

    # Autofill service
    autofill_service = AutofillService(db=db)

    # Alert service
    alert_service = AlertService(
        phone=settings.alerts.callmebot_phone,
        apikey=settings.alerts.callmebot_apikey,
        enabled=settings.alerts.whatsapp_enabled,
    )

    # Retrain
    models_dir = (Path(__file__).resolve().parents[3] / "backend" / "models").resolve()
    retrain = RetrainService(db=db, models_dir=models_dir)

    return Container(
        settings=settings,
        db=db,
        key_service=key_service,
        usage_service=usage_service,
        solver_service=solver,
        exam_service=exam_service,
        autofill_service=autofill_service,
        alert_service=alert_service,
        retrain_service=retrain,
    )
