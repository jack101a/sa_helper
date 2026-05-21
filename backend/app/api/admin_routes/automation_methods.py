from __future__ import annotations
from typing import Any
import json
from fastapi import APIRouter, Request, HTTPException, Body
from fastapi.responses import JSONResponse
from .utils import _admin_guard
from app.core.automation_method_utils import validate_automation_method_payload

router = APIRouter(tags=["admin-automation-methods"])

@router.get("/api/automation-methods")
async def list_methods(request: Request):
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    methods = container.db.list_automation_methods()
    return JSONResponse({"methods": methods})

@router.post("/api/automation-methods")
async def create_method(request: Request, payload: dict = Body(...)):
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    
    name = payload.get("name")
    description = payload.get("description", "")
    method_type = payload.get("method_type", "stall-flow")
    payload_json_str = payload.get("payload_json")
    
    if not name or not payload_json_str:
        raise HTTPException(400, "name and payload_json are required")
    
    try:
        payload_data = json.loads(payload_json_str)
        errors = validate_automation_method_payload(payload_data)
        if errors:
            return JSONResponse({"ok": False, "errors": errors}, status_code=400)
    except Exception as e:
        return JSONResponse({"ok": False, "errors": [f"Invalid JSON: {str(e)}"]}, status_code=400)
    
    method = container.db.create_automation_method(name, description, method_type, payload_json_str)
    return JSONResponse({"ok": True, "method": method})

@router.get("/api/automation-methods/{method_id}")
async def get_method(request: Request, method_id: int):
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    method = container.db.get_automation_method(method_id)
    if not method:
        raise HTTPException(404, "Method not found")
    return JSONResponse({"method": method})

@router.put("/api/automation-methods/{method_id}")
async def update_method(request: Request, method_id: int, payload: dict = Body(...)):
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    
    name = payload.get("name")
    description = payload.get("description")
    payload_json_str = payload.get("payload_json")
    enabled = payload.get("enabled")
    
    if payload_json_str:
        try:
            payload_data = json.loads(payload_json_str)
            errors = validate_automation_method_payload(payload_data)
            if errors:
                return JSONResponse({"ok": False, "errors": errors}, status_code=400)
        except Exception as e:
            return JSONResponse({"ok": False, "errors": [f"Invalid JSON: {str(e)}"]}, status_code=400)
            
    success = container.db.update_automation_method(
        method_id, name=name, description=description, 
        payload_json=payload_json_str, enabled=enabled
    )
    return JSONResponse({"ok": success})

@router.post("/api/automation-methods/{method_id}/activate")
async def activate_method(request: Request, method_id: int):
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    success = container.db.activate_automation_method(method_id)
    if not success:
        raise HTTPException(400, "Method not found or disabled")
    return JSONResponse({"ok": success})

@router.delete("/api/automation-methods/{method_id}")
async def delete_method(request: Request, method_id: int):
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    success = container.db.delete_automation_method(method_id)
    return JSONResponse({"ok": success})

@router.post("/api/automation-methods/validate")
async def validate_method(request: Request, payload: dict = Body(...)):
    denied = _admin_guard(request)
    if denied:
        return denied
    
    payload_json_str = payload.get("payload_json")
    if not payload_json_str:
        return JSONResponse({"ok": False, "errors": ["payload_json is required"]}, status_code=400)
        
    try:
        payload_data = json.loads(payload_json_str)
        errors = validate_automation_method_payload(payload_data)
        if errors:
            return JSONResponse({"ok": False, "errors": errors})
        return JSONResponse({"ok": True})
    except Exception as e:
        return JSONResponse({"ok": False, "errors": [f"Invalid JSON: {str(e)}"]})
