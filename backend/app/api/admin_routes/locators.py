from __future__ import annotations
from typing import Any
from fastapi import APIRouter, Request, Form
from fastapi.responses import RedirectResponse, JSONResponse
from .utils import _admin_guard

router = APIRouter(tags=["admin-locators"])

@router.post("/locators/approve")
async def approve_locator(request: Request, locator_id: int = Form(...)):
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    container.db.approve_locator(locator_id)
    return RedirectResponse(url="/admin/", status_code=303)

@router.post("/locators/reject")
async def reject_locator(request: Request, locator_id: int = Form(...)):
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    container.db.reject_locator(locator_id)
    return RedirectResponse(url="/admin/", status_code=303)


@router.get("/api/captcha/export")
async def export_captcha_config(request: Request) -> Any:
    """Export all field mappings and approved locators as JSON."""
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    return JSONResponse({
        "field_mappings": container.db.models.get_all_field_mappings(),
        "locators": container.db.autofill.get_approved_locators(),
    })


@router.post("/api/captcha/import")
async def import_captcha_config(request: Request) -> Any:
    """Import field mappings and locators from a JSON file."""
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    try:
        payload = await request.json()
        # Re-use parts of the master import logic but scoped to captcha
        with container.db.settings._lock:
            with container.db.settings.connect() as conn:
                # Import field_mappings
                for fm in payload.get("field_mappings", []) or []:
                    domain = container.db.settings._normalize_domain(fm.get("domain"))
                    field_name = str(fm.get("field_name") or "").strip()
                    task_type = str(fm.get("task_type") or "image").strip() or "image"
                    filename = str(fm.get("ai_model_filename") or "").strip()
                    if domain and field_name and filename:
                        # Find model ID by filename
                        row = conn.execute("SELECT id FROM model_registry WHERE ai_model_filename = ?", (filename,)).fetchone()
                        if row:
                            ai_model_id = int(row["id"])
                            conn.execute(
                                """
                                INSERT INTO field_mappings (domain, field_name, task_type, source_data_type, source_selector, target_data_type, target_selector, ai_model_id)
                                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                                ON CONFLICT(domain, field_name) DO UPDATE SET
                                    task_type = excluded.task_type,
                                    ai_model_id = excluded.ai_model_id
                                """,
                                (domain, field_name, task_type, fm.get("source_data_type"), fm.get("source_selector"), fm.get("target_data_type"), fm.get("target_selector"), ai_model_id),
                            )

                # Import locators
                locators = payload.get("locators", {}) or {}
                for domain, row in locators.items():
                    d = container.db.settings._normalize_domain(domain)
                    img = str((row or {}).get("img") or "").strip()
                    inp = str((row or {}).get("input") or "").strip()
                    if d and img and inp:
                        conn.execute(
                            "INSERT INTO locators (domain, image_selector, input_selector, status) VALUES (?, ?, ?, 'approved') "
                            "ON CONFLICT(domain) DO UPDATE SET image_selector=excluded.image_selector, input_selector=excluded.input_selector",
                            (d, img, inp),
                        )
                conn.commit()
        return JSONResponse({"ok": True})
    except Exception as e:
        raise HTTPException(400, detail=str(e))
