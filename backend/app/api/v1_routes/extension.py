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
from app.services.payload_signing_service import sign_payload

from .utils import (
    _AUTOMATION_SCRIPT_IDS,
    dynamic_automation_enabled,
    read_automation_script,
    compose_stall_flow_payload,
    get_request_entitlements,
    userscript_access,
    userscript_allowed_for_key,
    userscript_string_list,
    userscript_sync_status,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["v1"])

_STALL_RUNTIME_DEFAULTS = {
    "authentication_handler": {
        "runtimeRole": "stall_core",
        "runtimeRoles": ["stall_core", "stall_auth"],
        "stallRunMode": "stall_pages",
        "tags": ["stall"],
    },
    "bypass_sarathi_restrictions_v2": {
        "runtimeRole": "stall_core",
        "runtimeRoles": ["stall_core", "stall_sarathi_guard"],
        "stallRunMode": "stall_pages",
        "tags": ["stall"],
    },
    "enable_all_form_fields_for_stall": {
        "runtimeRole": "stall_core",
        "runtimeRoles": ["stall_core", "stall_form_unlocker"],
        "stallRunMode": "stall_pages",
        "tags": ["stall"],
    },
}


def _userscript_runtime_metadata(script_id: str, entry: dict) -> dict:
    defaults = _STALL_RUNTIME_DEFAULTS.get(str(script_id or "").strip()) or {}
    raw_tags = entry.get("tags")
    if raw_tags is None:
        raw_tags = entry.get("scriptTags")
    if raw_tags is None:
        raw_tags = entry.get("script_tags")
    if raw_tags is None:
        raw_tags = entry.get("runtimeTags")
    if raw_tags is None:
        raw_tags = entry.get("runtime_tags")
    if raw_tags is None:
        raw_tags = defaults.get("tags")
    tags: list[str] = []
    for tag in userscript_string_list(raw_tags):
        if tag not in tags:
            tags.append(tag)
    return {
        "runtimeRole": str(entry.get("runtimeRole") or entry.get("runtime_role") or defaults.get("runtimeRole") or ""),
        "runtimeRoles": userscript_string_list(entry.get("runtimeRoles") or entry.get("runtime_roles") or defaults.get("runtimeRoles")),
        "stallRunMode": str(entry.get("stallRunMode") or entry.get("stall_run_mode") or defaults.get("stallRunMode") or ""),
        "tags": tags,
    }


def _truthy_setting(value: str) -> bool:
    return str(value or "").strip().lower() in {"1", "true", "yes", "on"}


@router.get("/exam/learning-status")
async def get_exam_learning_status(request: Request) -> dict:
    container = request.app.state.container
    enabled = _truthy_setting(container.db.get_setting("exam.learning_enabled", "true"))
    return {"learning_enabled": enabled}


def _pattern_list(value: str) -> list[str]:
    out: list[str] = []
    for raw in str(value or "").replace(",", "\n").splitlines():
        item = raw.strip()
        if item and item not in out:
            out.append(item)
    return out


def _userscript_dir_has_readable_scripts(scripts_dir: Path) -> bool:
    """True when a source dir can produce at least one userscript payload."""
    if any(path.is_file() for path in scripts_dir.glob("*.user.js")):
        return True
    index_path = scripts_dir / "index.json"
    if not index_path.is_file():
        return False
    try:
        entries = json.loads(index_path.read_text(encoding="utf-8"))
    except Exception:
        return False
    if not isinstance(entries, list):
        return False
    scripts_dir_resolved = scripts_dir.resolve()
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        file_name = str(entry.get("file", "")).strip()
        if not file_name:
            continue
        try:
            path = (scripts_dir / file_name).resolve()
        except Exception:
            continue
        if scripts_dir_resolved in path.parents and path.is_file():
            return True
    return False


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


@router.get("/extension/config")
async def extension_config(request: Request) -> dict:
    """Server-controlled extension features synced to authenticated clients."""
    key_record = request.state.api_key_record
    if not key_record:
        raise HTTPException(401, "API key required")

    db = request.app.state.container.db
    return {
        "copy_unlocker": {
            "enabled": _truthy_setting(db.get_setting("extension.copy_unlocker.enabled", "false")),
            "sites": _pattern_list(db.get_setting("extension.copy_unlocker.sites", "")),
        }
    }


@router.get("/extension/public-key")
async def extension_public_key(request: Request) -> dict:
    """Return the payload-signing public key for unpacked/dev extension installs."""
    key_record = request.state.api_key_record
    if not key_record:
        raise HTTPException(401, "API key required")

    from app.services.payload_signing_service import ensure_public_key_b64

    return {"public_key_b64": ensure_public_key_b64()}


def _userscript_signature_payload(script_payload: dict) -> dict:
    """Canonical payload that is signed and verified by browser extensions."""
    return {
        "id": script_payload.get("id") or "",
        "file": script_payload.get("file") or "",
        "version": script_payload.get("version") or "",
        "matches": script_payload.get("matches") if isinstance(script_payload.get("matches"), list) else [],
        "includes": script_payload.get("includes") if isinstance(script_payload.get("includes"), list) else [],
        "exclude": script_payload.get("exclude") if isinstance(script_payload.get("exclude"), list) else [],
        "excludeMatches": script_payload.get("excludeMatches") if isinstance(script_payload.get("excludeMatches"), list) else [],
        "runAt": script_payload.get("runAt") or "",
        "requires": script_payload.get("requires") if isinstance(script_payload.get("requires"), list) else [],
        "resources": script_payload.get("resources") if isinstance(script_payload.get("resources"), list) else [],
        "noframes": script_payload.get("noframes") is True,
        "code": script_payload.get("code") or "",
    }


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
    entitlements = get_request_entitlements(request)
    root = get_project_root()
    source_dirs = [
        (root / "backend" / "datasets" / "userscripts").resolve(),
        (root / "data" / "mappings").resolve(),
        (root / "data" / "userscripts").resolve(),
    ]

    discovered: dict[str, tuple[Path, Path, dict]] = {}
    source_counts: dict[str, int] = {}

    for scripts_dir in source_dirs:
        if not _userscript_dir_has_readable_scripts(scripts_dir):
            continue
        source_key = str(scripts_dir.relative_to(root)) if scripts_dir.is_relative_to(root) else str(scripts_dir)
        index_path = scripts_dir / "index.json"
        entries: list[dict] = []
        if index_path.is_file():
            try:
                raw_entries = json.loads(index_path.read_text(encoding="utf-8"))
                if not isinstance(raw_entries, list):
                    raise ValueError("index.json must be a JSON array")
                entries = [entry for entry in raw_entries if isinstance(entry, dict)]
            except Exception as e:
                logger.exception("Failed to parse userscripts index %s: %s", index_path, e)
                entries = []
        else:
            entries = [
                {
                    "id": filepath.stem.replace(".user", ""),
                    "file": filepath.name,
                    "enabled": True,
                    "accessScope": "global",
                    "plans": [],
                    "apiKeyIds": [],
                    "services": [],
                }
                for filepath in sorted(scripts_dir.glob("*.user.js"))
                if filepath.is_file()
            ]

        for entry in entries:
            file_name = str(entry.get("file", "")).strip()
            if not file_name:
                continue
            try:
                path = (scripts_dir / file_name).resolve()
            except Exception:
                continue
            if scripts_dir not in path.parents or not path.is_file():
                logger.warning("Skipping invalid userscript entry", extra={"context": {"source": source_key, "file": file_name}})
                continue
            script_id = str(entry.get("id") or Path(file_name).stem.replace(".user", "")).strip()
            if not script_id:
                continue
            discovered[script_id] = (scripts_dir, path, entry)
            source_counts[source_key] = source_counts.get(source_key, 0) + 1

    scripts_data: list[dict] = []
    skipped = 0
    failed = 0

    for script_id, (scripts_dir, path, entry) in discovered.items():
        file_name = str(entry.get("file") or path.name)
        try:
            if not userscript_allowed_for_key(entry, key_record, entitlements):
                skipped += 1
                continue
            code = path.read_text(encoding="utf-8")
            parsed = parse_userscript_meta(code)
            access = userscript_access(entry)
            runtime_metadata = _userscript_runtime_metadata(script_id, entry)
            if not runtime_metadata["tags"]:
                runtime_metadata["tags"] = userscript_string_list(parsed.get("tags", []))
            script_payload = {
                "id": script_id,
                "file": file_name,
                "name": str(entry.get("name") or parsed["name"] or script_id),
                "version": str(entry.get("version") or parsed["version"]),
                "description": str(entry.get("description") or parsed["description"]),
                "sourceUrl": str(entry.get("sourceUrl") or entry.get("installUrl") or parsed["downloadURL"] or ""),
                "enabled": bool(entry.get("enabled", True)),
                "accessScope": access["accessScope"],
                "plans": access["plans"],
                "apiKeyIds": access["apiKeyIds"],
                "services": access["services"],
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
                **runtime_metadata,
                "diagnostics": parsed.get("diagnostics", {"warnings": [], "errors": []}),
                "syncStatus": userscript_sync_status(parsed),
                "updatedAt": int(path.stat().st_mtime),
                "code": code,
            }
            signature_payload = _userscript_signature_payload(script_payload)
            script_payload["signaturePayload"] = signature_payload
            script_payload["signature"] = sign_payload("userscript", signature_payload)
            scripts_data.append(script_payload)
        except Exception as e:
            failed += 1
            logger.exception("Failed userscript entry %s from %s: %s", file_name, scripts_dir, e)

    meta = {
        "discovered": len(discovered),
        "delivered": len(scripts_data),
        "skipped": skipped,
        "failed": failed,
        "sources": source_counts,
    }
    logger.info("userscripts_sync_complete", extra={"context": meta})
    return {"scripts": scripts_data, "meta": meta}


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

    container = request.app.state.container
    # Key validation is already handled by AuthMiddleware.
    # We only allow specific step_ids to prevent arbitrary file reading.
    if step_id not in _AUTOMATION_SCRIPT_IDS:
        raise HTTPException(400, "Invalid step_id")
    ensure_service_allowed(request, "exam")
    if step_id in {"step4", "stall-flow"}:
        ensure_service_allowed(request, "solver")

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

        signed_payload = {"step_id": step_id, "payload": payload}
        return {
            **signed_payload,
            "signature": sign_payload("stall_payload", signed_payload),
        }
    except HTTPException:
        raise
    except Exception as error:
        logger.exception("automation_payload_failed", extra={"context": {"error": str(error)}})
        raise HTTPException(500, "Failed to read automation payload")
