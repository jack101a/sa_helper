"""Dependency container — Unified Platform."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from app.core.config import Settings
from app.core.database import Database
from app.core.db import init_db as init_sqlalchemy_db, get_session
from app.core.paths import get_project_root
from app.services.alert_service import AlertService
from app.services.audit_service import AuditService
from app.services.autofill_service import AutofillService
from app.services.cache_service import CacheService
from app.services.exam_service import ExamService
from app.services.key_service import KeyService
from app.services.model_router import ModelRouter
from app.services.payment_service import PaymentService
from app.services.solver_service import SolverService
from app.services.subscription_service import SubscriptionService
from app.services.usage_service import UsageService
from app.services.user_service import UserService
from app.services.usage_cycle_service import UsageCycleService
from app.services.rate_limiter import RateLimiter
from app.services.backup_service import BackupService
from app.services.extension_service import ExtensionService
from app.services.user_key_service import UserKeyService



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
    extension_service: ExtensionService # Browser extension packaging

    # New scalable services (SQLAlchemy-based)
    user_service: UserService = field(default=None)
    subscription_service: SubscriptionService = field(default=None)
    payment_service: PaymentService = field(default=None)
    audit_service: AuditService = field(default=None)
    usage_cycle_service: UsageCycleService = field(default=None)
    rate_limiter: RateLimiter = field(default=None)
    backup_service: BackupService = field(default=None)
    user_key_service: UserKeyService = field(default=None)



def build_container(settings: Settings) -> Container:
    """Initialize and wire all services."""

    # Legacy raw-SQL database (existing api_keys, usage_events, etc.)
    db = Database(settings=settings)
    db.init()

    # New SQLAlchemy-based database (users, subscriptions, payments, etc.)
    init_sqlalchemy_db(settings)
    # Import models to register them with Base.metadata before creating tables
    import app.core.models  # noqa: F401
    # Local/dev convenience. Production containers run Alembic in the entrypoint.
    create_tables = os.getenv("CREATE_ALL_TABLES", "true").strip().lower() in {"1", "true", "yes", "on"}
    if create_tables:
        from app.core.db import create_all_tables
        create_all_tables()
    if db.legacy_sqlalchemy_enabled:
        db.ensure_master_key()

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
    data_dir = get_project_root() / "data"
    data_dir = data_dir.resolve()
    exam_service = ExamService(db=db, data_dir=data_dir)

    # Autofill service
    autofill_service = AutofillService(db=db)

    # Alert service — reads phone/apikey/enabled from DB (admin dashboard)
    alert_service = AlertService(db=db)

    # Extension service
    root_dir = get_project_root()
    output_dir = root_dir / "backend" / "app" / "static" / "extensions"
    extension_service = ExtensionService(root_dir=root_dir, output_dir=output_dir)

    # New scalable services (SQLAlchemy-based)
    user_service = UserService(session_factory=get_session)
    subscription_service = SubscriptionService(session_factory=get_session)
    subscription_service.seed_default_plans()
    payment_service = PaymentService(session_factory=get_session)
    audit_service = AuditService(session_factory=get_session)
    usage_cycle_service = UsageCycleService(session_factory=get_session)
    rate_limiter = RateLimiter(settings=settings)
    backup_service = BackupService(settings=settings)
    user_key_service = UserKeyService(session_factory=get_session, settings=settings)

    return Container(
        settings=settings,
        db=db,
        key_service=key_service,
        usage_service=usage_service,
        solver_service=solver,
        exam_service=exam_service,
        autofill_service=autofill_service,
        alert_service=alert_service,
        extension_service=extension_service,
        user_service=user_service,
        subscription_service=subscription_service,
        payment_service=payment_service,
        audit_service=audit_service,
        usage_cycle_service=usage_cycle_service,
        rate_limiter=rate_limiter,
        backup_service=backup_service,
        user_key_service=user_key_service,
    )

