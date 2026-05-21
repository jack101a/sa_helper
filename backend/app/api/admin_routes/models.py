from __future__ import annotations
import base64
import sqlite3
from pathlib import Path
from typing import Any
from fastapi import APIRouter, Request, Form, File, UploadFile, HTTPException
from fastapi.responses import RedirectResponse, JSONResponse
from .utils import (
    _admin_guard, _write_auto_backup, _slug, _model_upload_error,
    _model_upload_success, _default_field_for_task, _wants_json
)
from urllib.parse import quote_plus
from app.core.database import Database
from app.core.paths import get_project_root

router = APIRouter(tags=["admin-models"])

_PROJECT_ROOT = get_project_root()
_MODELS_DIR = (_PROJECT_ROOT / "data" / "models").resolve()
_DATASETS_DIR = (_PROJECT_ROOT / "backend" / "datasets").resolve()

@router.post("/routes")
async def update_route(request: Request, domain: str = Form(...), ai_model_filename: str = Form(...)):
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    container.db.set_model_route(domain, ai_model_filename)
    return RedirectResponse(url="/admin/", status_code=303)

@router.post("/models/upload")
async def upload_model(
    request: Request,
    ai_model_file: UploadFile | None = File(None),
    legacy_upload_file: UploadFile | None = File(None, alias="model_file"),
    file: UploadFile | None = File(None),
    ai_model_name: str = Form(""),
    legacy_model_name: str = Form("", alias="model_name"),
    version: str = Form("v1"),
    task_type: str = Form("image"),
    runtime: str = Form("onnx"),
    notes: str = Form(""),
):
    denied = _admin_guard(request)
    if denied:
        return denied
    if runtime not in {"onnx"}:
        return _model_upload_error(request, "Runtime must be ONNX")
    if task_type not in {"image", "audio", "text"}:
        return _model_upload_error(request, "Task type must be image/audio/text")

    container = request.app.state.container
    filename_on_disk = ""
    uploaded_file = ai_model_file or legacy_upload_file or file
    clean_model_name = (ai_model_name or "").strip() or (legacy_model_name or "").strip()
    clean_version = version.strip() or "v1"
    clean_notes = notes.strip() or None

    if not clean_model_name:
        return _model_upload_error(request, "Model name is required")

    if not uploaded_file or not uploaded_file.filename:
        return _model_upload_error(request, "Model file is required")
    suffix = Path(uploaded_file.filename).suffix.lower()
    if suffix != ".onnx":
        return _model_upload_error(request, "Only .onnx uploads are supported")
    _MODELS_DIR.mkdir(parents=True, exist_ok=True)
    base_filename = f"{_slug(clean_model_name)}_{_slug(clean_version)}.onnx"
    filename_on_disk = base_filename
    candidate = _MODELS_DIR / filename_on_disk
    n = 2
    while candidate.exists():
        filename_on_disk = f"{_slug(clean_model_name)}_{_slug(clean_version)}_{n}.onnx"
        candidate = _MODELS_DIR / filename_on_disk
        n += 1
    target = _MODELS_DIR / filename_on_disk
    bytes_written = 0
    try:
        with target.open("wb") as out_f:
            while True:
                chunk = await uploaded_file.read(1024 * 1024)
                if not chunk:
                    break
                out_f.write(chunk)
                bytes_written += len(chunk)
        await uploaded_file.close()
    except Exception as exc:
        try:
            target.unlink(missing_ok=True)
        except Exception:
            pass
        return _model_upload_error(request, f"Failed to write model file: {exc}", status_code=500)

    if bytes_written <= 0:
        target.unlink(missing_ok=True)
        return _model_upload_error(request, "Uploaded file is empty")

    try:
        container.db.add_model_registry_entry(
            ai_model_name=clean_model_name,
            version=clean_version,
            task_type=task_type,
            ai_runtime=runtime,
            ai_model_filename=filename_on_disk,
            notes=clean_notes,
            status="active",
            lifecycle_state="candidate",
        )
    except sqlite3.IntegrityError:
        target.unlink(missing_ok=True)
        return _model_upload_error(request, "Model filename already exists")
    except Exception as exc:
        target.unlink(missing_ok=True)
        return _model_upload_error(request, f"Upload failed: {exc}", status_code=500)
    _write_auto_backup(container, "upload_model")
    return _model_upload_success(
        request,
        message=f"Model uploaded: {filename_on_disk}",
        filename_on_disk=filename_on_disk,
    )

@router.post("/models/remove")
async def remove_model(request: Request, ai_model_id: int = Form(...)):
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    entry = container.db.get_model_registry_entry(ai_model_id)
    if not entry:
        if _wants_json(request):
            return JSONResponse(status_code=404, content={"ok": False, "message": f"Model #{ai_model_id} not found"})
        return RedirectResponse(url="/admin/", status_code=303)
    # Guard: block deletion if any field_mappings still reference this model
    dependent_mappings = [
        m for m in container.db.get_all_field_mappings()
        if int(m.get("ai_model_id") or 0) == ai_model_id
    ]
    if dependent_mappings:
        domains = sorted({m["domain"] for m in dependent_mappings})
        msg = (
            f"Cannot delete model #{ai_model_id}: "
            f"{len(dependent_mappings)} mapping(s) across domain(s) {', '.join(domains)} still reference it. "
            f"Reassign those mappings first via the Domain Mapping panel."
        )
        if _wants_json(request):
            return JSONResponse(status_code=409, content={"ok": False, "message": msg})
        raise HTTPException(status_code=409, detail=msg)
    runtime = entry.get("ai_runtime")
    filename = entry.get("ai_model_filename")
    if runtime == "onnx" and filename:
        target = (_MODELS_DIR / str(filename)).resolve()
        # Prevent path traversal: ensure the resolved path is within _MODELS_DIR
        if _MODELS_DIR.resolve() in target.parents or target == _MODELS_DIR.resolve():
            if target.exists():
                target.unlink(missing_ok=True)
    container.db.delete_model_registry_entry(ai_model_id)
    _write_auto_backup(container, "remove_model")
    if _wants_json(request):
        return JSONResponse(status_code=200, content={"ok": True})
    return RedirectResponse(url="/admin/", status_code=303)


@router.post("/models/update")
async def update_model(
    request: Request,
    ai_model_id: int = Form(...),
    ai_model_name: str = Form(...),
    version: str = Form("v1"),
    task_type: str = Form("image"),
    lifecycle_state: str = Form("candidate"),
    notes: str = Form(""),
):
    denied = _admin_guard(request)
    if denied:
        return denied
    if task_type not in {"image", "audio", "text"}:
        raise HTTPException(status_code=400, detail="task_type must be image|audio|text")
    if lifecycle_state not in {"candidate", "staging", "production", "rolled_back"}:
        raise HTTPException(status_code=400, detail="invalid lifecycle_state")
    container = request.app.state.container
    container.db.update_model_registry_entry(
        ai_model_id=ai_model_id,
        ai_model_name=ai_model_name.strip(),
        version=version.strip() or "v1",
        task_type=task_type,
        notes=(notes.strip() or None),
        lifecycle_state=lifecycle_state,
    )
    _write_auto_backup(container, "update_model")
    return RedirectResponse(url="/admin/", status_code=303)

@router.post("/mappings/set")
async def set_mapping(
    request: Request,
    domain: str = Form(...),
    field_name: str = Form(""),
    field_key: str = Form(""),
    task_type: str = Form(""),
    source_data_type: str = Form("image"),
    source_selector: str = Form(""),
    target_data_type: str = Form("text"),
    target_selector: str = Form(""),
    ai_model_id: int = Form(...),
):
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    # Use the explicit task_type when provided; fall back to source_data_type
    clean_task_type = (task_type or source_data_type or "").strip().lower()
    clean_source_data_type = (source_data_type or task_type or "").strip().lower()
    if clean_task_type not in {"image", "audio", "text"}:
        raise HTTPException(status_code=400, detail="task_type must be image|audio|text")
    clean_source_selector = source_selector.strip()
    clean_target_selector = target_selector.strip()
    clean_field = field_name.strip() or _default_field_for_task(clean_task_type)
    clean_domain = Database._normalize_domain(domain)
    if not clean_domain:
        raise HTTPException(status_code=400, detail="domain is required")
    container.db.set_field_mapping(
        domain=clean_domain,
        field_name=clean_field,
        task_type=clean_task_type,
        source_data_type=clean_source_data_type,
        source_selector=clean_source_selector,
        target_data_type=target_data_type.strip() or "text",
        target_selector=clean_target_selector,
        ai_model_id=ai_model_id,
    )
    _write_auto_backup(container, "set_mapping")
    return RedirectResponse(url="/admin/", status_code=303)

@router.post("/mappings/update")
async def update_mapping(
    request: Request,
    mapping_id: int = Form(...),
    domain: str = Form(...),
    field_name: str = Form(""),
    field_key: str = Form(""),
    task_type: str = Form(""),
    source_data_type: str = Form("image"),
    source_selector: str = Form(""),
    target_data_type: str = Form("text"),
    target_selector: str = Form(""),
    ai_model_id: int = Form(...),
):
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    clean_task_type = (task_type or source_data_type or "").strip().lower()
    clean_source_data_type = (source_data_type or task_type or "").strip().lower()
    if clean_task_type not in {"image", "audio", "text"}:
        raise HTTPException(status_code=400, detail="task_type must be image|audio|text")
    clean_source_selector = source_selector.strip()
    clean_target_selector = target_selector.strip()
    clean_field = field_name.strip() or _default_field_for_task(clean_task_type)
    clean_domain = Database._normalize_domain(domain)
    if not clean_domain:
        raise HTTPException(status_code=400, detail="domain is required")
    container.db.update_field_mapping(
        mapping_id=mapping_id,
        domain=clean_domain,
        field_name=clean_field,
        task_type=clean_task_type,
        source_data_type=clean_source_data_type,
        source_selector=clean_source_selector,
        target_data_type=target_data_type.strip() or "text",
        target_selector=clean_target_selector,
        ai_model_id=ai_model_id,
    )
    _write_auto_backup(container, "update_mapping")
    return RedirectResponse(url="/admin/", status_code=303)

@router.post("/mappings/domain/update")
async def update_mapping_domain(
    request: Request,
    old_domain: str = Form(...),
    new_domain: str = Form(...),
):
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    clean_old = Database._normalize_domain(old_domain)
    clean_new = Database._normalize_domain(new_domain)
    if not clean_old or not clean_new:
        raise HTTPException(status_code=400, detail="old_domain and new_domain are required")
    try:
        updated = container.db.rename_domain_mappings(clean_old, clean_new)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if updated <= 0:
        raise HTTPException(status_code=404, detail="no mappings found for domain")
    _write_auto_backup(container, "rename_mapping_domain")
    return RedirectResponse(url="/admin/", status_code=303)

@router.post("/mappings/domain/assign-model")
async def assign_model_to_domain(
    request: Request,
    domain: str = Form(...),
    ai_model_id: int = Form(...),
):
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    # Validate the model exists in registry before attempting assignment
    model_entry = container.db.get_model_registry_entry(ai_model_id)
    if not model_entry:
        msg = f"Model #{ai_model_id} not found in registry"
        if _wants_json(request):
            return JSONResponse(status_code=400, content={"ok": False, "message": msg})
        raise HTTPException(status_code=400, detail=msg)
    updated = container.db.assign_model_to_domain(domain=domain, ai_model_id=ai_model_id)
    if updated <= 0:
        msg = (
            f"No field mappings found for domain '{domain}'. "
            f"Create at least one routing map for this domain first."
        )
        if _wants_json(request):
            return JSONResponse(status_code=400, content={"ok": False, "message": msg})
        raise HTTPException(status_code=400, detail=msg)
    _write_auto_backup(container, "assign_model_to_domain")
    if _wants_json(request):
        return JSONResponse(status_code=200, content={"ok": True, "updated": updated})
    return RedirectResponse(url="/admin/", status_code=303)

@router.post("/mappings/remove")
async def remove_mapping(request: Request, mapping_id: int = Form(...)):
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    container.db.remove_field_mapping(mapping_id)
    _write_auto_backup(container, "remove_mapping")
    return RedirectResponse(url="/admin/", status_code=303)

@router.post("/mappings/test")
async def test_mapping(request: Request, mapping_id: int = Form(...)):
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    mapping = next((m for m in container.db.get_all_field_mappings() if int(m["id"]) == mapping_id), None)
    if not mapping:
        return RedirectResponse(url="/admin/?test_status=error&test_message=Mapping+not+found", status_code=303)
    if not mapping.get("ai_model_name") or not mapping.get("ai_model_filename"):
        return RedirectResponse(
            url="/admin/?test_status=error&test_message=Mapping+has+no+active+model+assigned",
            status_code=303,
        )
    if str(mapping.get("ai_runtime")) != "onnx":
        return RedirectResponse(
            url="/admin/?test_status=error&test_message=Mapping+runtime+must+be+onnx",
            status_code=303,
        )
    model_filename = str(mapping.get("ai_model_filename") or "").strip()
    if not model_filename:
        return RedirectResponse(
            url="/admin/?test_status=error&test_message=Mapping+has+no+model+filename",
            status_code=303,
        )
    model_file = _MODELS_DIR / model_filename
    if not model_file.exists():
        return RedirectResponse(
            url=f"/admin/?test_status=error&test_message={quote_plus(f'Registered model file not found on disk: {model_filename}. Re-upload this model in Model Registry.')}",
            status_code=303,
        )

    prefix = f"{mapping['domain']}_"
    files = [p for p in _DATASETS_DIR.glob(f"{prefix}*") if p.is_file()]
    if not files:
        return RedirectResponse(
            url=f"/admin/?test_status=error&test_message={quote_plus('No dataset sample file found for this domain')}",
            status_code=303,
        )
    latest = sorted(files, key=lambda p: p.stat().st_mtime, reverse=True)[0]
    # base64 imported at top of module
    raw = latest.read_bytes()
    payload_base64 = base64.b64encode(raw).decode("ascii")

    try:
        solved = await container.solver_service.submit(
            task_type=mapping["task_type"],
            payload_base64=payload_base64,
            mode="accurate",
            domain=mapping["domain"],
            field_name=mapping["field_name"],
        )
        preview = str(solved.get("result", ""))[:80]
        used = str(solved.get("model_used", "-"))
        msg = f"model={used} | result={preview}"
        return RedirectResponse(
            url=f"/admin/?test_status=ok&test_message={quote_plus(msg)}",
            status_code=303,
        )
    except Exception as exc:
        return RedirectResponse(
            url=f"/admin/?test_status=error&test_message={quote_plus(str(exc))}",
            status_code=303,
        )

@router.post("/models/promote")
async def promote_model(request: Request, ai_model_id: int = Form(...), lifecycle_state: str = Form(...)):
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    key_record = getattr(request.state, "api_key_record", None)
    changed_by = int(key_record["id"]) if key_record else None
    if lifecycle_state not in {"candidate", "staging", "production"}:
        raise HTTPException(status_code=400, detail="invalid lifecycle_state")
    target = container.db.get_model_registry_entry(ai_model_id)
    if not target:
        raise HTTPException(status_code=404, detail="model not found")
    container.db.set_lifecycle_state(
        ai_model_id=ai_model_id,
        to_state=lifecycle_state,
        changed_by=changed_by,
        reason="Promoted from admin dashboard",
    )
    return RedirectResponse(url="/admin/", status_code=303)

@router.post("/models/rollback")
async def rollback_model(request: Request, ai_model_id: int = Form(...)):
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    key_record = getattr(request.state, "api_key_record", None)
    changed_by = int(key_record["id"]) if key_record else None
    current = container.db.get_model_registry_entry(ai_model_id)
    if not current:
        raise HTTPException(status_code=404, detail="model not found")

    container.db.set_lifecycle_state(
        ai_model_id=ai_model_id,
        to_state="rolled_back",
        changed_by=changed_by,
        reason="Manual rollback requested",
    )
    fallback = container.db.get_latest_model_by_state(
        task_type=current["task_type"],
        lifecycle_state="staging",
        exclude_id=ai_model_id,
    ) or container.db.get_latest_model_by_state(
        task_type=current["task_type"],
        lifecycle_state="candidate",
        exclude_id=ai_model_id,
    )
    if fallback:
        container.db.set_lifecycle_state(
            ai_model_id=int(fallback["id"]),
            to_state="production",
            changed_by=changed_by,
            reason=f"Promoted during rollback of model {ai_model_id}",
        )
    return RedirectResponse(url="/admin/", status_code=303)

@router.post("/mappings/proposals/reject")
async def reject_field_mapping_proposal(request: Request, proposal_id: int = Form(...)):
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    container.db.mark_field_mapping_proposal_status(proposal_id, "rejected")
    return RedirectResponse(url="/admin/", status_code=303)

@router.post("/mappings/proposals/approve")
async def approve_field_mapping_proposal(
    request: Request,
    proposal_id: int = Form(...),
    ai_model_id: int = Form(...),
):
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    proposal = next(
        (row for row in container.db.get_pending_field_mapping_proposals() if int(row["id"]) == proposal_id),
        None,
    )
    if not proposal:
        raise HTTPException(status_code=404, detail="proposal not found")
    container.db.set_field_mapping(
        domain=proposal["domain"],
        field_name=_default_field_for_task(proposal["task_type"]),
        task_type=proposal["task_type"],
        source_data_type=proposal["source_data_type"],
        source_selector=proposal["source_selector"],
        target_data_type=proposal["target_data_type"],
        target_selector=proposal["target_selector"],
        ai_model_id=ai_model_id,
    )
    container.db.mark_field_mapping_proposal_status(proposal_id, "approved")
    return RedirectResponse(url="/admin/", status_code=303)
