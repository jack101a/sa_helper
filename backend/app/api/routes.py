"""V1 API route composition."""

from __future__ import annotations

from fastapi import APIRouter

from app.api.v1_routes import autofill, captcha, exam, extension, keys

router = APIRouter(prefix="/v1", tags=["v1"])

router.include_router(extension.router)
router.include_router(captcha.router)
router.include_router(exam.router)
router.include_router(autofill.router)
router.include_router(keys.router)
