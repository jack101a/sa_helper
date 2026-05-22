"""Userscripts and automation payload endpoints."""

from __future__ import annotations

import json
import logging
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request

from app.core.paths import get_project_root
from app.core.userscript_utils import parse_userscript_meta
from app.core.automation_method_utils import validate_automation_method_payload, compose_dynamic_stall_flow

from .utils import (
    _AUTOMATION_SCRIPT_IDS,
    dynamic_automation_enabled,
    read_automation_script,
    compose_stall_flow_payload,
    userscript_access,
    userscript_allowed_for_key,
    userscript_sync_status,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["v1"])


def _extension_reports_dir() -> Path:
    path = get_project_root() / "data" / "extension_error_reports"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _classify_extension_error(message: str) -> str:
    text = message.lower()
    if any(token in text for token in ("failed to fetch", "networkerror", "timeout", "err_internet", "err_connection", "http 502", "http 503", "http 504")):
        return "connection"
    if any(token in text for token in ("extension context invalidated", "receiving end does not exist", "message port closed")):
        return "extension_lifecycle"
    if any(token in text for token in ("permission", "notallowederror", "notreadableerror", "devicesnotfounderror")):
        return "browser_permission"
    if any(token in text for token in ("selector", "not found", "cannot read properties", "undefined", "null")):
        return "site_dom"
    return "runtime"


def _write_extension_error_summary(events: list[dict]) -> dict:
    reports_dir = _extension_reports_dir()
    existing: list[dict] = []
    log_path = reports_dir / "events.jsonl"
    if log_path.exists():
        lines = log_path.read_text(encoding="utf-8").splitlines()[-500:]
        for line in lines:
            try:
                existing.append(json.loads(line))
            except Exception:
                continue
    recent = existing + events
    categories = Counter(str(item.get("category", "runtime")) for item in recent)
    sources = Counter(str(item.get("source", "extension")) for item in recent)
    top_messages = Counter(str(item.get("message", ""))[:160] for item in recent if item.get("message")).most_common(20)
    summary = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "window_events": len(recent),
        "categories": dict(categories),
        "sources": dict(sources),
        "top_messages": [{"message": message, "count": count} for message, count in top_messages],
        "interpretation": {
            "connection": "Usually backend/network availability or timeout noise.",
            "extension_lifecycle": "Usually expected during extension reloads, tab closes, or content-script navigation.",
            "browser_permission": "Usually camera/browser permission, device, or site media policy related.",
            "site_dom": "Usually selectors or page structure changed before automation acted.",
            "runtime": "Needs inspection if repeated.",
        },
    }
    (reports_dir / "latest_summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    return summary


@router.get("/userscripts/sync")
async def sync_userscripts(request: Request) -> dict:
    """
    Sync backend-managed userscripts to the extension.
    Source of truth:
    - Optional index file in data/userscripts or data/mappings
    - Fallback: all *.user.js files in the first populated source directory
    """
    key_record = request.state.api_key_record
    if not key_record:
        raise HTTPException(401, "API key required")
    container = request.app.state.container
    entitlements = container.db.get_api_key_entitlements(int(key_record["id"]))
    root = get_project_root()
    candidate_dirs = [
        (root / "data" / "userscripts").resolve(),
        (root / "data" / "mappings").resolve(),
        (root / "backend" / "datasets" / "userscripts").resolve(),
    ]
    scripts_dir = next(
        (
            item for item in candidate_dirs
            if (item / "index.json").is_file() or any(item.glob("*.user.js"))
        ),
        candidate_dirs[0],
    )

    scripts_data: list[dict] = []
    index_path = scripts_dir / "index.json"

    if index_path.is_file():
        try:
            entries = json.loads(index_path.read_text(encoding="utf-8"))
            if not isinstance(entries, list):
                raise ValueError("index.json must be a JSON array")
            for entry in entries:
                if not isinstance(entry, dict):
                    continue
                file_name = str(entry.get("file", "")).strip()
                if not file_name:
                    continue
                try:
                    path = (scripts_dir / file_name).resolve()
                    if scripts_dir.resolve() not in path.parents or not path.is_file():
                        raise ValueError(f"Invalid userscript file: {file_name}")
                    code = path.read_text(encoding="utf-8")
                    parsed = parse_userscript_meta(code)
                    script_id = str(entry.get("id") or Path(file_name).stem.replace(".user", "")).strip()
                    if not userscript_allowed_for_key(entry, key_record, entitlements):
                        continue
                    access = userscript_access(entry)
                    scripts_data.append({
                        "id": script_id,
                        "name": str(entry.get("name") or parsed["name"] or script_id),
                        "version": str(entry.get("version") or parsed["version"]),
                        "description": str(entry.get("description") or parsed["description"]),
                        "sourceUrl": str(entry.get("sourceUrl") or entry.get("installUrl") or parsed["downloadURL"] or ""),
                        "enabled": bool(entry.get("enabled", True)),
                        "accessScope": access["accessScope"],
                        "plans": access["plans"],
                        "apiKeyIds": access["apiKeyIds"],
                        "matches": entry.get("matches") if isinstance(entry.get("matches"), list) else parsed["matches"],
                        "includes": entry.get("includes") if isinstance(entry.get("includes"), list) else parsed["includes"],
                        "exclude": entry.get("exclude") if isinstance(entry.get("exclude"), list) else parsed["exclude"],
                        "excludeMatches": entry.get("excludeMatches") if isinstance(entry.get("excludeMatches"), list) else parsed["excludeMatches"],
                        "runAt": str(entry.get("runAt") or parsed["runAt"]),
                        "requires": entry.get("requires") if isinstance(entry.get("requires"), list) else parsed["requires"],
                        "resources": entry.get("resources") if isinstance(entry.get("resources"), list) else parsed["resources"],
                        "grants": entry.get("grants") if isinstance(entry.get("grants"), list) else parsed["grants"],
                        "connects": entry.get("connects") if isinstance(entry.get("connects"), list) else parsed["connects"],
                        "noframes": bool(entry.get("noframes", parsed["noframes"])),
                        "diagnostics": parsed.get("diagnostics", {"warnings": [], "errors": []}),
                        "syncStatus": userscript_sync_status(parsed),
                        "updatedAt": int(path.stat().st_mtime),
                        "code": code,
                    })
                except Exception as e:
                    logger.exception("Failed userscript entry %s: %s", file_name, e)
        except Exception as e:
            logger.exception("Failed to parse userscripts index.json: %s", e)
    else:
        for filepath in scripts_dir.glob("*.user.js"):
            if not filepath.is_file():
                continue
            try:
                code = filepath.read_text(encoding="utf-8")
                parsed = parse_userscript_meta(code)
                script_id = filepath.stem.replace(".user", "")
                entry = {"enabled": True, "accessScope": "global", "plans": [], "apiKeyIds": []}
                if not userscript_allowed_for_key(entry, key_record, entitlements):
                    continue
                scripts_data.append({
                    "id": script_id,
                    "name": parsed["name"] or script_id,
                    "version": parsed["version"],
                    "description": parsed["description"],
                    "sourceUrl": parsed["downloadURL"],
                    "enabled": True,
                    "accessScope": "global",
                    "plans": [],
                    "apiKeyIds": [],
                    "matches": parsed["matches"],
                    "includes": parsed["includes"],
                    "exclude": parsed["exclude"],
                    "excludeMatches": parsed["excludeMatches"],
                    "runAt": parsed["runAt"],
                    "requires": parsed["requires"],
                    "resources": parsed["resources"],
                    "grants": parsed["grants"],
                    "connects": parsed["connects"],
                    "noframes": parsed["noframes"],
                    "diagnostics": parsed.get("diagnostics", {"warnings": [], "errors": []}),
                    "syncStatus": userscript_sync_status(parsed),
                    "updatedAt": int(filepath.stat().st_mtime),
                    "code": code,
                })
            except Exception as e:
                logger.exception("Failed to read userscript %s: %s", filepath.name, e)

    return {"scripts": scripts_data}


@router.post("/extension/error-report")
async def receive_extension_error_report(request: Request) -> dict:
    """Receive throttled extension diagnostics and keep an admin-readable report."""
    key_record = request.state.api_key_record
    if not key_record:
        raise HTTPException(401, "API key required")

    try:
        body = await request.json()
    except Exception:
        raise HTTPException(400, "Invalid JSON")

    raw_events = body.get("events")
    if isinstance(raw_events, dict):
        raw_events = [raw_events]
    if not isinstance(raw_events, list):
        raise HTTPException(400, "events must be a list")

    now = datetime.now(timezone.utc).isoformat()
    device_id = getattr(request.state, "device_id", "")
    extension_version = str(body.get("extensionVersion") or "")
    accepted: list[dict] = []
    for item in raw_events[:50]:
        if not isinstance(item, dict):
            continue
        message = str(item.get("message") or "").strip()
        if not message:
            continue
        event = {
            "received_at": now,
            "api_key_id": key_record.get("id"),
            "device_id": device_id,
            "extension_version": extension_version,
            "ts": item.get("ts"),
            "level": str(item.get("level") or "error")[:20],
            "source": str(item.get("source") or "extension")[:80],
            "message": message[:1000],
            "url": str(item.get("url") or "")[:500],
            "stack": str(item.get("stack") or "")[:2000],
            "context": item.get("context") if isinstance(item.get("context"), dict) else {},
        }
        event["category"] = _classify_extension_error(event["message"])
        accepted.append(event)

    if accepted:
        reports_dir = _extension_reports_dir()
        summary = _write_extension_error_summary(accepted)
        with (reports_dir / "events.jsonl").open("a", encoding="utf-8") as fh:
            for event in accepted:
                fh.write(json.dumps(event, ensure_ascii=False) + "\n")
    else:
        summary = {}

    return {"ok": True, "accepted": len(accepted), "summary": summary}


@router.get("/automation/payload/{step_id}")
async def get_automation_payload(request: Request, step_id: str) -> dict:
    """Serve stateless automation scripts for STALL payloads."""
    from .utils import ensure_service_allowed

    ensure_service_allowed(request, "stall")
    container = request.app.state.container
    # Key validation is already handled by AuthMiddleware.
    # We only allow specific step_ids to prevent arbitrary file reading.
    if step_id not in _AUTOMATION_SCRIPT_IDS:
        raise HTTPException(400, "Invalid step_id")

    try:
        payload = None

        if step_id == "stall-flow":
            # 1. Try dynamic method if enabled
            if dynamic_automation_enabled(container):
                method = container.db.get_active_automation_method("stall-flow")
                if method:
                    try:
                        payload_data = json.loads(method["payload_json"])
                        errors = validate_automation_method_payload(payload_data)
                        if not errors:
                            payload = compose_dynamic_stall_flow(payload_data)
                        else:
                            logger.error("active_automation_method_invalid", extra={"context": {"method_id": method["id"], "errors": errors}})
                    except Exception as e:
                        logger.error("active_automation_method_parse_failed", extra={"context": {"method_id": method["id"], "error": str(e)}})

            # 2. Fallback to file-based composition
            if not payload:
                payload = compose_stall_flow_payload(
                    step3_code=read_automation_script("step3"),
                    step4_code=read_automation_script("step4"),
                )
        else:
            # For other steps (step3/step4 individually), always use file-based for now
            payload = read_automation_script(step_id)

        return {"step_id": step_id, "payload": payload}
    except HTTPException:
        raise
    except Exception as error:
        logger.exception("automation_payload_failed", extra={"context": {"error": str(error)}})
        raise HTTPException(500, "Failed to read automation payload")
