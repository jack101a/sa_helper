from __future__ import annotations
import base64
import os
from pathlib import Path
from datetime import datetime
from typing import Any
from fastapi import APIRouter, Request, Response
from fastapi.responses import JSONResponse, FileResponse, HTMLResponse
from fastapi.templating import Jinja2Templates
from .utils import _admin_guard, _fmt_dt

router = APIRouter(tags=["admin-analytics"])

_PROJECT_ROOT = Path(__file__).resolve().parents[4]
_DATASETS_DIR = (_PROJECT_ROOT / "backend" / "datasets").resolve()
_ADMIN_UI_INDEX = (_PROJECT_ROOT / "frontend" / "dist" / "index.html").resolve()
_IGNORED_FAILED_DOMAINS = {"localhost", "127.0.0.1", "ratetest.local"}

# Use absolute path for templates
_TEMPLATE_DIR = Path(__file__).resolve().parents[2] / "templates"
templates = Jinja2Templates(directory=str(_TEMPLATE_DIR))

async def _collect_datasets_files(container, labels_by_file: dict) -> list[dict[str, str]]:
    datasets_files: list[dict[str, str]] = []
    _DATASETS_DIR.mkdir(parents=True, exist_ok=True)
    image_exts = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif"}
    latest_files = [
        item
        for item in sorted(_DATASETS_DIR.glob("*"), key=lambda p: p.stat().st_mtime, reverse=True)
        if item.is_file() and item.suffix.lower() in image_exts
    ]
    for item in latest_files:
        if not item.is_file():
            continue
        stat = item.stat()
        stem = item.stem
        domain_guess = stem.rsplit("_", 1)[0] if "_" in stem else ""
        domain_lc = domain_guess.lower().strip()
        if domain_lc in _IGNORED_FAILED_DOMAINS or domain_lc.endswith(".local"):
            continue
        ocr_guess = "(decode failed)"
        try:
            payload_base64 = base64.b64encode(item.read_bytes()).decode("ascii")
            solved = await container.solver_service.submit(
                task_type="image",
                payload_base64=payload_base64,
                mode="accurate",
                domain=domain_guess or None,
                field_name="image_default",
            )
            ocr_guess = str(solved.get("result", "")).strip() or "(empty)"
        except Exception:
            ocr_guess = "(decode failed)"
        datasets_files.append(
            {
                "id": item.name,
                "name": item.name,
                "path": str(item),
                "domain": domain_guess or "-",
                "preview_url": f"/admin/datasets/preview/{item.name}",
                "size_kb": f"{max(1, int(stat.st_size / 1024))}",
                "updated_at": datetime.fromtimestamp(stat.st_mtime).strftime("%d-%b-%Y %H:%M"),
                "ocr_guess": ocr_guess[:120],
                "corrected_text": str(labels_by_file.get(item.name, {}).get("corrected_text", "")),
            }
        )
        if len(datasets_files) >= 10:
            break
    return datasets_files

@router.get("/api/bootstrap")
async def admin_bootstrap(request: Request):
    """Lightweight JSON payload for future React admin UI."""
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    usage = container.db.get_usage_summary()
    labels_by_file = container.db.get_failed_payload_labels()
    api_keys = container.db.get_all_api_keys()
    for key in api_keys:
        key_id = int(key["id"])
        key["created_at_display"] = _fmt_dt(key.get("created_at"))
        key["expires_at_display"] = _fmt_dt(key.get("expires_at"))
        key["revoked_at_display"] = _fmt_dt(key.get("revoked_at"))
        key["allowed_domains"] = container.db.get_api_key_allowed_domains(key_id)
        key["rate_limit"] = container.db.get_api_key_rate_limit(key_id) or {}
        key["device_binding"] = container.db.get_api_key_device_binding(key_id)
    datasets_files = await _collect_datasets_files(container, labels_by_file)
    return {
        "usage": usage,
        "global_access": container.db.get_global_access(),
        "allowed_domains": container.db.get_allowed_domains(),
        "model_registry": container.db.get_model_registry(),
        "field_mappings": container.db.get_all_field_mappings(),
        "field_mapping_proposals": container.db.get_pending_field_mapping_proposals(),
        "api_keys": api_keys,
        "datasets_dir": str(_DATASETS_DIR),
        "datasets_files": datasets_files,
        "cloud_backup_configured": bool(os.getenv("BACKUP_CLOUD_UPLOAD_URL", "").strip()),
        "master_key_info": container.db.get_master_key_info(),
    }

@router.get("/", response_class=HTMLResponse)
async def admin_dashboard(request: Request):
    """Render main admin dashboard."""
    denied = _admin_guard(request)
    if denied:
        return denied
    if _ADMIN_UI_INDEX.exists():
        return FileResponse(str(_ADMIN_UI_INDEX))
    container = request.app.state.container

    usage = container.db.get_usage_summary()
    global_access = container.db.get_global_access()
    allowed_domains = container.db.get_allowed_domains()
    model_routes = container.db.get_all_model_routes()
    model_registry = container.db.get_model_registry()
    field_mappings = container.db.get_all_field_mappings()
    field_mapping_proposals = container.db.get_pending_field_mapping_proposals()
    labels_by_file = container.db.get_failed_payload_labels()

    # Get all API keys for management
    all_keys = container.db.get_all_api_keys()
    for key in all_keys:
        key["created_at_display"] = _fmt_dt(key.get("created_at"))
        key["expires_at_display"] = _fmt_dt(key.get("expires_at"))
        key["revoked_at_display"] = _fmt_dt(key.get("revoked_at"))

    datasets_files = await _collect_datasets_files(container, labels_by_file)

    test_status = request.query_params.get("test_status", "")
    test_message = request.query_params.get("test_message", "")

    return templates.TemplateResponse("admin.html", {
        "request": request,
        "usage": usage,
        "global_access": global_access,
        "allowed_domains": allowed_domains,
        "model_routes": model_routes,
        "model_registry": model_registry,
        "field_mappings": field_mappings,
        "field_mapping_proposals": field_mapping_proposals,
        "api_keys": all_keys,
        "datasets_dir": str(_DATASETS_DIR),
        "datasets_files": datasets_files,
        "test_status": test_status,
        "test_message": test_message,
    })

@router.get("/api/exam/stats")
async def get_exam_stats(request: Request) -> Any:
    """Get high-level MCQ/exam statistics."""
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    stats = container.db.get_exam_stats()
    return JSONResponse(stats)
