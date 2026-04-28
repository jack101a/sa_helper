from __future__ import annotations
import json as _json
from typing import Any
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import JSONResponse
from .utils import _admin_guard

router = APIRouter(tags=["admin-autofill"])

@router.get("/api/autofill/proposals")
async def get_autofill_proposals(request: Request) -> Any:
    """List proposals for admin review."""
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    status = request.query_params.get("status")
    if status == "all":
        status = None
    proposals = container.db.get_autofill_proposals(status=status)
    return JSONResponse(proposals)

@router.post("/api/autofill/proposals/{proposal_id}/approve")
async def approve_autofill_proposal(request: Request, proposal_id: int) -> Any:
    """Approve a proposal and generate a server_rule_id."""
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    try:
        server_rule_id = container.db.approve_autofill_proposal(proposal_id, reviewed_by="admin")
        return JSONResponse({"ok": True, "server_rule_id": server_rule_id})
    except Exception as e:
        raise HTTPException(400, str(e))

@router.post("/api/autofill/proposals/{proposal_id}/reject")
async def reject_autofill_proposal(request: Request, proposal_id: int) -> Any:
    """Reject a proposal."""
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    container.db.reject_autofill_proposal(proposal_id, reviewed_by="admin")
    return JSONResponse({"ok": True})

@router.post("/api/autofill/proposals/bulk-approve")
async def bulk_approve_autofill_proposals(request: Request) -> Any:
    """Approve multiple proposals."""
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    try:
        body = await request.json()
        proposal_ids = body.get("proposal_ids", [])
        results = []
        for pid in proposal_ids:
            try:
                rid = container.db.approve_autofill_proposal(pid, reviewed_by="admin")
                results.append(rid)
            except Exception:
                pass
        return JSONResponse({"ok": True, "count": len(results)})
    except Exception as e:
        raise HTTPException(400, str(e))

@router.post("/api/autofill/proposals/bulk-reject")
async def bulk_reject_autofill_proposals(request: Request) -> Any:
    """Reject multiple proposals."""
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    try:
        body = await request.json()
        proposal_ids = body.get("proposal_ids", [])
        for pid in proposal_ids:
            container.db.reject_autofill_proposal(pid, reviewed_by="admin")
        return JSONResponse({"ok": True, "count": len(proposal_ids)})
    except Exception as e:
        raise HTTPException(400, str(e))


@router.patch("/api/autofill/proposals/{proposal_id}")
async def edit_autofill_proposal(request: Request, proposal_id: int) -> Any:
    """Edit an autofill proposal's rule_json and/or status.

    Body (JSON): { "rule_json": "...", "status": "pending|approved|rejected" }
    Both fields are optional; at least one must be provided.
    """
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(400, detail="Invalid JSON body")

    rule_json = body.get("rule_json")        # raw string or None
    status    = body.get("status")

    # If caller passed a dict/object for rule_json, serialize it
    if rule_json is not None and not isinstance(rule_json, str):
        rule_json = _json.dumps(rule_json)

    if rule_json is None and status is None:
        raise HTTPException(400, detail="Provide at least one of: rule_json, status")

    try:
        updated = container.db.update_autofill_proposal(
            proposal_id, rule_json=rule_json, status=status
        )
        if not updated:
            raise HTTPException(404, detail="Proposal not found")
        return JSONResponse({"ok": True})
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(400, detail=str(e))


@router.delete("/api/autofill/proposals/{proposal_id}")
async def delete_autofill_proposal(request: Request, proposal_id: int) -> Any:
    """Permanently delete an autofill proposal."""
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    deleted = container.db.delete_autofill_proposal(proposal_id)
    if not deleted:
        raise HTTPException(404, detail="Proposal not found")
    return JSONResponse({"ok": True})


@router.get("/api/autofill/export")
async def export_autofill_rules(request: Request) -> Any:
    """Export all approved autofill rules as JSON."""
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    rules = container.db.autofill.get_approved_autofill_rules()
    return JSONResponse({"rules": rules})


@router.post("/api/autofill/import")
async def import_autofill_rules(request: Request) -> Any:
    """Import autofill rules from a JSON file."""
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    try:
        body = await request.json()
        rules = body.get("rules", [])
        if not isinstance(rules, list):
            raise ValueError("Expected 'rules' list in JSON body")
        count = container.db.autofill.bulk_import_approved_rules(rules)
        return JSONResponse({"ok": True, "imported": count})
    except Exception as e:
        raise HTTPException(400, detail=str(e))
