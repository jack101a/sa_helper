"""Admin routes — Captcha / Field-Mapping Proposals.

The approve flow mirrors the old tata_captcha-test project:
  - Admin explicitly picks which AI model to assign (no guessing)
  - If no model_id is sent, returns 400 with list of available models
"""
from __future__ import annotations
from typing import Any
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import JSONResponse
from .utils import _admin_guard

router = APIRouter(tags=["admin-captcha-proposals"])


def _approve_one(container, proposal_id: int, model_id: int) -> None:
    """Shared approval logic: promote proposal → field_mapping."""
    with container.db.models.connect() as conn:
        row = conn.execute(
            "SELECT * FROM field_mapping_proposals WHERE id = ?", (proposal_id,)
        ).fetchone()
    if not row:
        raise HTTPException(404, detail=f"Proposal {proposal_id} not found")
    p = dict(row)

    # Validate model exists and is active
    registry = container.db.get_model_registry()
    model = next((m for m in registry if int(m["id"]) == model_id), None)
    if not model:
        raise HTTPException(400, detail=f"Model {model_id} not found in registry")
    if model.get("status") != "active":
        raise HTTPException(400, detail=f"Model {model_id} is not active (status: {model.get('status')})")

    field_name = (p.get("proposed_field_name") or "").strip() or f"{p['task_type']}_default"
    container.db.set_field_mapping(
        domain=p["domain"],
        field_name=field_name,
        task_type=p["task_type"],
        ai_model_id=model_id,
        source_data_type=p.get("source_data_type") or p["task_type"],
        source_selector=p.get("source_selector", ""),
        target_data_type=p.get("target_data_type") or "text_input",
        target_selector=p.get("target_selector", ""),
    )
    container.db.mark_field_mapping_proposal_status(proposal_id, "approved")


@router.get("/api/captcha/proposals")
async def get_captcha_proposals(request: Request) -> Any:
    """List field-mapping (captcha route) proposals.

    ?status=pending (default) | all | approved | rejected
    """
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    status = request.query_params.get("status", "pending")
    if status == "all":
        with container.db.models.connect() as conn:
            rows = conn.execute(
                "SELECT * FROM field_mapping_proposals ORDER BY id DESC LIMIT 500"
            ).fetchall()
        return JSONResponse([dict(r) for r in rows])
    if status in ("approved", "rejected"):
        with container.db.models.connect() as conn:
            rows = conn.execute(
                "SELECT * FROM field_mapping_proposals WHERE status = ? ORDER BY id DESC LIMIT 200",
                (status,),
            ).fetchall()
        return JSONResponse([dict(r) for r in rows])
    # Default: pending
    return JSONResponse(container.db.get_pending_field_mapping_proposals())


@router.post("/api/captcha/proposals/{proposal_id}/approve")
async def approve_captcha_proposal(request: Request, proposal_id: int) -> Any:
    """Approve a captcha route proposal.

    Body (JSON): { "model_id": <int> }
    The admin must explicitly choose which model to assign — no auto-guessing.
    If model_id is omitted, returns 400 with the list of available models.
    """
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container

    body: dict = {}
    try:
        body = await request.json()
    except Exception:
        pass

    model_id = body.get("model_id")
    if model_id is None:
        # Return available models so the UI can prompt
        registry = container.db.get_model_registry()
        active = [
            {"id": m["id"], "ai_model_name": m["ai_model_name"], "version": m["version"],
             "task_type": m["task_type"], "lifecycle_state": m["lifecycle_state"]}
            for m in registry if m.get("status") == "active"
        ]
        return JSONResponse(
            status_code=400,
            content={"ok": False, "error": "model_id is required", "available_models": active}
        )

    try:
        _approve_one(container, proposal_id, int(model_id))
        return JSONResponse({"ok": True})
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(400, detail=str(e))


@router.post("/api/captcha/proposals/{proposal_id}/reject")
async def reject_captcha_proposal(request: Request, proposal_id: int) -> Any:
    """Reject a captcha route proposal."""
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    # Verify it exists
    with container.db.models.connect() as conn:
        row = conn.execute(
            "SELECT id FROM field_mapping_proposals WHERE id = ?", (proposal_id,)
        ).fetchone()
    if not row:
        raise HTTPException(404, detail="Proposal not found")
    container.db.mark_field_mapping_proposal_status(proposal_id, "rejected")
    return JSONResponse({"ok": True})


@router.post("/api/captcha/proposals/bulk-approve")
async def bulk_approve_captcha_proposals(request: Request) -> Any:
    """Approve multiple proposals with an explicit model.

    Body: { "proposal_ids": [1, 2, 3], "model_id": <int> }
    """
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    try:
        body = await request.json()
        ids = [int(i) for i in body.get("proposal_ids", [])]
        model_id = body.get("model_id")

        if not ids:
            return JSONResponse({"ok": True, "count": 0})
        if model_id is None:
            registry = container.db.get_model_registry()
            active = [
                {"id": m["id"], "ai_model_name": m["ai_model_name"], "version": m["version"],
                 "task_type": m["task_type"], "lifecycle_state": m["lifecycle_state"]}
                for m in registry if m.get("status") == "active"
            ]
            return JSONResponse(
                status_code=400,
                content={"ok": False, "error": "model_id is required", "available_models": active}
            )

        count = 0
        errors = []
        for pid in ids:
            try:
                _approve_one(container, pid, int(model_id))
                count += 1
            except HTTPException as e:
                errors.append({"id": pid, "error": e.detail})
            except Exception as e:
                errors.append({"id": pid, "error": str(e)})
        return JSONResponse({"ok": True, "count": count, "errors": errors})
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(400, detail=str(e))


@router.post("/api/captcha/proposals/bulk-reject")
async def bulk_reject_captcha_proposals(request: Request) -> Any:
    """Reject multiple captcha route proposals.

    Body: { "proposal_ids": [1, 2, 3] }
    """
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    try:
        body = await request.json()
        ids = [int(i) for i in body.get("proposal_ids", [])]
        for pid in ids:
            container.db.mark_field_mapping_proposal_status(pid, "rejected")
        return JSONResponse({"ok": True, "count": len(ids)})
    except Exception as e:
        raise HTTPException(400, detail=str(e))


@router.patch("/api/captcha/proposals/{proposal_id}")
async def edit_captcha_proposal(request: Request, proposal_id: int) -> Any:
    """Edit editable fields of a captcha/field-mapping proposal.

    Body (JSON): any subset of {domain, task_type, source_selector, target_selector,
                                 proposed_field_name, source_data_type, target_data_type, status}
    """
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(400, detail="Invalid JSON body")
    if not body:
        raise HTTPException(400, detail="No fields provided")
    try:
        updated = container.db.update_field_mapping_proposal(proposal_id, **body)
        if not updated:
            raise HTTPException(404, detail="Proposal not found")
        return JSONResponse({"ok": True})
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(400, detail=str(e))


@router.delete("/api/captcha/proposals/{proposal_id}")
async def delete_captcha_proposal(request: Request, proposal_id: int) -> Any:
    """Permanently delete a captcha/field-mapping proposal."""
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    deleted = container.db.delete_field_mapping_proposal(proposal_id)
    if not deleted:
        raise HTTPException(404, detail="Proposal not found")
    return JSONResponse({"ok": True})
