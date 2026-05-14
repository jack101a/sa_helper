"""Admin dashboard route definitions — Router Composition."""

from __future__ import annotations
from fastapi import APIRouter
from app.api.admin_routes import (
    auth, keys, models, datasets, backups, autofill, locators,
    settings, analytics, captcha_proposals, users, payments, subscriptions,
    user_keys, system, automation_methods,
)

router = APIRouter(prefix="/admin", tags=["admin"])

# Include sub-routers — API routes first, then catch-all SPA fallback LAST
router.include_router(auth.router)
router.include_router(keys.router)
router.include_router(models.router)
router.include_router(datasets.router)
router.include_router(backups.router)
router.include_router(autofill.router)
router.include_router(locators.router)
router.include_router(settings.router)
router.include_router(captcha_proposals.router)
router.include_router(users.router)
router.include_router(payments.router)
router.include_router(subscriptions.router)
router.include_router(user_keys.router)
router.include_router(system.router)
router.include_router(automation_methods.router)
# Analytics MUST be last — its catch-all /{full_path:path} serves the SPA
router.include_router(analytics.router)
