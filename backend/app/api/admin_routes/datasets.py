from __future__ import annotations
import mimetypes
import os
import shutil
from pathlib import Path
from datetime import datetime
from fastapi import APIRouter, Request, Form, HTTPException, Response
from fastapi.responses import RedirectResponse
from .utils import _admin_guard, _safe_label

router = APIRouter(tags=["admin-datasets"])

_PROJECT_ROOT = Path(__file__).resolve().parents[4]
_DATASETS_DIR = (_PROJECT_ROOT / "backend" / "datasets").resolve()

@router.get("/datasets/file/{filename}")
async def download_dataset_file(request: Request, filename: str):
    denied = _admin_guard(request)
    if denied:
        return denied
    safe = os.path.basename(filename)
    target = (_DATASETS_DIR / safe).resolve()
    if target.parent != _DATASETS_DIR.resolve() or not target.exists() or not target.is_file():
        raise HTTPException(status_code=404, detail="file not found")
    media_type = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
    return Response(content=target.read_bytes(), media_type=media_type, headers={
        "Content-Disposition": f'attachment; filename="{safe}"'
    })

@router.get("/datasets/preview/{filename}")
async def preview_dataset_file(request: Request, filename: str):
    denied = _admin_guard(request)
    if denied:
        return denied
    safe = os.path.basename(filename)
    target = (_DATASETS_DIR / safe).resolve()
    if target.parent != _DATASETS_DIR.resolve() or not target.exists() or not target.is_file():
        raise HTTPException(status_code=404, detail="file not found")
    media_type = mimetypes.guess_type(target.name)[0] or "image/png"
    return Response(content=target.read_bytes(), media_type=media_type)

@router.post("/datasets/label")
async def save_failed_payload_label(
    request: Request,
    filename: str = Form(...),
    domain: str = Form(""),
    ai_guess: str = Form(""),
    corrected_text: str = Form(...),
):
    denied = _admin_guard(request)
    if denied:
        return denied
    safe = os.path.basename(filename)
    target = (_DATASETS_DIR / safe).resolve()
    if target.parent != _DATASETS_DIR.resolve() or not target.exists() or not target.is_file():
        raise HTTPException(status_code=404, detail="file not found")
    clean_corrected = corrected_text.strip()
    if not clean_corrected:
        raise HTTPException(status_code=400, detail="corrected_text is required")
    container = request.app.state.container
    container.db.upsert_failed_payload_label(
        filename=safe,
        domain=domain.strip() or "unknown",
        ai_guess=ai_guess.strip() or None,
        corrected_text=clean_corrected,
    )
    labeled_dir = (_DATASETS_DIR / "labeled").resolve()
    labeled_dir.mkdir(parents=True, exist_ok=True)
    label_token = _safe_label(clean_corrected)
    candidate_name = f"{label_token}{target.suffix.lower()}"
    labeled_path = (labeled_dir / candidate_name).resolve()
    if labeled_path.parent != labeled_dir:
        raise HTTPException(status_code=400, detail="invalid labeled target path")
    n = 2
    while labeled_path.exists():
        candidate_name = f"{label_token}_{n}{target.suffix.lower()}"
        labeled_path = (labeled_dir / candidate_name).resolve()
        n += 1
    shutil.move(str(target), str(labeled_path))
    return RedirectResponse(url="/admin/?test_status=ok&test_message=Correction+saved+and+moved+to+labeled+dataset", status_code=303)

@router.get("/datasets/label")
async def datasets_label_get_redirect(request: Request):
    denied = _admin_guard(request)
    if denied:
        return denied
    return RedirectResponse(url="/admin/?test_status=error&test_message=Use+Save+button+to+submit+correction", status_code=303)

@router.post("/datasets/ignore")
async def ignore_failed_payload(
    request: Request,
    filename: str = Form(...),
):
    denied = _admin_guard(request)
    if denied:
        return denied
    safe = os.path.basename(filename)
    target = (_DATASETS_DIR / safe).resolve()
    if target.parent != _DATASETS_DIR.resolve() or not target.exists() or not target.is_file():
        raise HTTPException(status_code=404, detail="file not found")
    ignored_dir = (_DATASETS_DIR / "ignored").resolve()
    ignored_dir.mkdir(parents=True, exist_ok=True)
    ignored_target = (ignored_dir / safe).resolve()
    if ignored_target.parent != ignored_dir:
        raise HTTPException(status_code=400, detail="invalid ignored target path")
    n = 2
    stem = Path(safe).stem
    suffix = Path(safe).suffix
    while ignored_target.exists():
        ignored_target = (ignored_dir / f"{stem}_{n}{suffix}").resolve()
        n += 1
    shutil.move(str(target), str(ignored_target))
    return RedirectResponse(url="/admin/?test_status=ok&test_message=Failed+payload+ignored", status_code=303)

@router.get("/datasets/ignore")
async def datasets_ignore_get_redirect(request: Request):
    denied = _admin_guard(request)
    if denied:
        return denied
    return RedirectResponse(url="/admin/?test_status=error&test_message=Use+Ignore+button+to+submit+ignore+action", status_code=303)

@router.get("/export/datasets.json")
async def export_datasets_metadata(request: Request):
    denied = _admin_guard(request)
    if denied:
        return denied
    files = []
    _DATASETS_DIR.mkdir(parents=True, exist_ok=True)
    for item in sorted(_DATASETS_DIR.glob("*"), key=lambda p: p.stat().st_mtime, reverse=True):
        if not item.is_file():
            continue
        stat = item.stat()
        files.append(
            {
                "filename": item.name,
                "path": str(item),
                "size_bytes": int(stat.st_size),
                "updated_at": datetime.fromtimestamp(stat.st_mtime).isoformat(),
            }
        )
    import json
    payload = {"exported_at": datetime.utcnow().isoformat() + "Z", "datasets": files}
    return Response(
        content=json.dumps(payload, indent=2),
        media_type="application/json",
        headers={"Content-Disposition": 'attachment; filename="datasets-metadata-export.json"'},
    )
