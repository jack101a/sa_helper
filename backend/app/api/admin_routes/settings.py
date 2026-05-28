from __future__ import annotations
import os
import json
import re
from pathlib import Path
from fastapi import APIRouter, Request, Form, HTTPException, UploadFile, File
from fastapi.responses import RedirectResponse, FileResponse
from pydantic import BaseModel
from app.core.userscript_utils import parse_userscript_meta
from app.core.paths import get_project_root
from .utils import _admin_guard, _write_auto_backup

router = APIRouter(tags=["admin-settings"])
_PROJECT_ROOT = get_project_root()
_USERSCRIPTS_DIR = (_PROJECT_ROOT / "data" / "mappings").resolve()
_STALL_CORE_USERSCRIPT_DEFAULTS = {
    "authentication_handler": {
        "accessScope": "global",
        "services": [],
        "runtimeRole": "stall_core",
        "runtimeRoles": ["stall_core", "stall_auth"],
        "stallRunMode": "stall_pages",
        "tags": ["stall"],
    },
    "bypass_sarathi_restrictions_v2": {
        "accessScope": "global",
        "services": [],
        "runtimeRole": "stall_core",
        "runtimeRoles": ["stall_core", "stall_sarathi_guard"],
        "stallRunMode": "stall_pages",
        "tags": ["stall"],
    },
    "enable_all_form_fields_for_stall": {
        "accessScope": "global",
        "services": [],
        "runtimeRole": "stall_core",
        "runtimeRoles": ["stall_core", "stall_form_unlocker"],
        "stallRunMode": "stall_pages",
        "tags": ["stall"],
    },
}


def _user_extension_package_dir() -> Path:
    return (_PROJECT_ROOT / "data" / "extension_packages").resolve()


def _extension_filename_for_format(fmt: str, variant: str = "admin") -> str:
    normalized = str(fmt or "").strip().lower()
    normalized_variant = str(variant or "admin").strip().lower()
    if normalized_variant not in {"admin", "user"}:
        raise HTTPException(400, "Unsupported extension variant. Use admin or user.")
    admin_mapping = {
        "zip": "mcq_solver_extension.zip",
        "crx": "mcq_solver_extension.crx",
        "xpi": "mcq_solver_extension.xpi",
    }
    user_mapping = {
        "zip": "mcq_solver_extension_user.zip",
        "crx": "mcq_solver_extension_user.crx",
        "xpi": "mcq_solver_extension_user.xpi",
    }
    mapping = user_mapping if normalized_variant == "user" else admin_mapping
    if normalized not in mapping:
        raise HTTPException(400, "Unsupported extension format. Use zip, crx, or xpi.")
    return mapping[normalized]


def _extension_media_type(filename: str) -> str:
    if filename.endswith(".zip"):
        return "application/zip"
    if filename.endswith(".xpi"):
        return "application/x-xpinstall"
    return "application/octet-stream"


def _user_extension_artifact_path(filename: str) -> Path:
    if Path(filename).name != filename:
        raise HTTPException(400, "Invalid extension filename.")
    package_dir = _user_extension_package_dir()
    artifact_path = (package_dir / filename).resolve()
    if artifact_path.parent != package_dir:
        raise HTTPException(400, "Invalid extension path.")
    return artifact_path


def _extension_artifact_path(container, filename: str, variant: str) -> Path:
    if variant == "user":
        service_dir = getattr(container.extension_service, "user_output_dir", None)
        if service_dir:
            return (Path(service_dir) / filename).resolve()
        return _user_extension_artifact_path(filename)
    return container.extension_service.output_dir / filename


def _ensure_headers(name: str, version: str, matches: list[str], runAt: str, code: str) -> str:
    if "==UserScript==" in code:
        return code
    header = [
        "// ==UserScript==",
        f"// @name        {name}",
        f"// @version     {version}",
        f"// @run-at       {runAt}",
    ]
    for m in matches:
        header.append(f"// @match       {m}")
    header.append("// ==/UserScript==")
    header.append("")
    return "\n".join(header) + "\n" + code


def _userscript_sync_status(meta: dict) -> str:
    diagnostics = meta.get("diagnostics") if isinstance(meta, dict) else {}
    errors = diagnostics.get("errors") if isinstance(diagnostics, dict) else []
    return "error" if errors else "ready"


def _access_scope(value: object) -> str:
    scope = str(value or "global").strip().lower()
    if scope in {"all", "public"}:
        return "global"
    if scope in {"plans"}:
        return "plan"
    if scope in {"keys", "user", "users"}:
        return "key"
    if scope in {"global", "plan", "key", "custom", "service"}:
        return scope
    return "global"


def _string_list(value: object) -> list[str]:
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    if isinstance(value, str):
        return [item.strip() for item in re.split(r"[,;\n]+", value) if item.strip()]
    return []


def _int_list(value: object) -> list[int]:
    items = value if isinstance(value, list) else _string_list(value)
    out: list[int] = []
    for item in items:
        try:
            out.append(int(item))
        except (TypeError, ValueError):
            continue
    return out


def _access_from_entry(entry: dict | None) -> dict:
    entry = entry or {}
    defaults = _STALL_CORE_USERSCRIPT_DEFAULTS.get(str(entry.get("id") or "").strip())
    return {
        "accessScope": _access_scope(entry.get("accessScope") or entry.get("access_scope") or entry.get("scope") or (defaults or {}).get("accessScope")),
        "plans": _string_list(entry.get("plans") or entry.get("plan_names") or entry.get("allowed_plans")),
        "apiKeyIds": _int_list(entry.get("apiKeyIds") or entry.get("api_key_ids") or entry.get("allowed_api_key_ids")),
        "services": _string_list(entry.get("services") or entry.get("service") or entry.get("serviceNames") or entry.get("service_names") or (defaults or {}).get("services")),
    }


def _access_from_body(body: dict, fallback: dict | None = None) -> dict:
    fallback_access = _access_from_entry(fallback)
    return {
        "accessScope": _access_scope(body.get("accessScope") or body.get("access_scope") or body.get("scope") or fallback_access["accessScope"]),
        "plans": _string_list(body.get("plans", fallback_access["plans"])),
        "apiKeyIds": _int_list(body.get("apiKeyIds", body.get("api_key_ids", fallback_access["apiKeyIds"]))),
        "services": _string_list(body.get("services", body.get("serviceNames", fallback_access["services"]))),
    }


def _runtime_metadata_from_entry(entry: dict | None) -> dict:
    entry = entry or {}
    defaults = _STALL_CORE_USERSCRIPT_DEFAULTS.get(str(entry.get("id") or "").strip()) or {}
    runtime_role = str(entry.get("runtimeRole") or entry.get("runtime_role") or defaults.get("runtimeRole") or "").strip()
    runtime_roles = _string_list(entry.get("runtimeRoles") or entry.get("runtime_roles") or defaults.get("runtimeRoles"))
    stall_run_mode = str(entry.get("stallRunMode") or entry.get("stall_run_mode") or defaults.get("stallRunMode") or "").strip()
    out: dict[str, object] = {}
    if runtime_role:
        out["runtimeRole"] = runtime_role
    if runtime_roles:
        out["runtimeRoles"] = runtime_roles
    if stall_run_mode:
        out["stallRunMode"] = stall_run_mode
    return out


def _tags_from_entry(entry: dict | None) -> list[str]:
    entry = entry or {}
    defaults = _STALL_CORE_USERSCRIPT_DEFAULTS.get(str(entry.get("id") or "").strip()) or {}
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
    for item in _string_list(raw_tags):
        if item not in tags:
            tags.append(item)
    return tags


def _runtime_metadata_from_body(body: dict, fallback: dict | None = None) -> dict:
    if any(key in body for key in ("runtimeRole", "runtime_role", "runtimeRoles", "runtime_roles", "stallRunMode", "stall_run_mode")):
        merged = {**(fallback or {})}
        for key in ("runtimeRole", "runtime_role", "runtimeRoles", "runtime_roles", "stallRunMode", "stall_run_mode"):
            if key in body:
                merged[key] = body[key]
        return _runtime_metadata_from_entry(merged)
    return _runtime_metadata_from_entry(fallback)


def _tags_from_body(body: dict, fallback: dict | None = None) -> list[str]:
    if "tags" in body or "scriptTags" in body or "script_tags" in body or "runtimeTags" in body or "runtime_tags" in body:
        raw = body.get("tags", body.get("scriptTags", body.get("script_tags", body.get("runtimeTags", body.get("runtime_tags", [])))))
        tags: list[str] = []
        for item in _string_list(raw):
            clean = re.sub(r"[^A-Za-z0-9_.:-]+", "_", item.strip()).strip("_").lower()
            if clean and clean not in tags:
                tags.append(clean)
        return tags
    return _tags_from_entry(fallback)


def _update_index(access_updates: dict[str, dict] | None = None):
    _USERSCRIPTS_DIR.mkdir(parents=True, exist_ok=True)
    index_path = (_USERSCRIPTS_DIR / "index.json").resolve()
    existing_entries = {}
    if index_path.is_file():
        try:
            data = json.loads(index_path.read_text(encoding="utf-8"))
            if isinstance(data, list):
                for e in data:
                    if isinstance(e, dict) and "id" in e:
                        existing_entries[str(e["id"])] = e
        except Exception:
            pass
    new_index = []
    for file_path in sorted(_USERSCRIPTS_DIR.glob("*.user.js")):
        if not file_path.is_file():
            continue
        code = file_path.read_text(encoding="utf-8")
        meta = parse_userscript_meta(code)
        uid = file_path.stem.replace(".user", "")
        enabled = True
        if uid in existing_entries:
            enabled = bool(existing_entries[uid].get("enabled", True))
        if access_updates and uid in access_updates and "enabled" in access_updates[uid]:
            enabled = bool(access_updates[uid].get("enabled"))
        access = _access_from_entry(existing_entries.get(uid))
        if access_updates and uid in access_updates:
            access = _access_from_body(access_updates[uid], access)
        runtime_metadata = _runtime_metadata_from_entry(existing_entries.get(uid))
        tags = _tags_from_entry(existing_entries.get(uid))
        if not tags:
            tags = _tags_from_body({"tags": meta.get("tags", [])}, {"id": uid})
        if access_updates and uid in access_updates:
            tags = _tags_from_body(access_updates[uid], existing_entries.get(uid))
            runtime_metadata = _runtime_metadata_from_body(access_updates[uid], existing_entries.get(uid))
        new_index.append({
            "id": uid,
            "file": file_path.name,
            "name": meta["name"] or uid,
            "version": meta["version"],
            "sourceUrl": meta["downloadURL"],
            "enabled": enabled,
            "accessScope": access["accessScope"],
            "plans": access["plans"],
            "apiKeyIds": access["apiKeyIds"],
            "services": access["services"],
            "tags": tags,
            "matches": meta["matches"],
            "includes": meta["includes"],
            "exclude": meta["exclude"],
            "excludeMatches": meta["excludeMatches"],
            "runAt": meta["runAt"],
            "requires": meta["requires"],
            "resources": meta["resources"],
            "grants": meta["grants"],
            "connects": meta["connects"],
            "noframes": meta["noframes"],
            "diagnostics": meta.get("diagnostics", {"warnings": [], "errors": []}),
            "syncStatus": _userscript_sync_status(meta),
            **runtime_metadata,
        })
    index_path.write_text(json.dumps(new_index, indent=2), encoding="utf-8")

@router.post("/access")
async def update_access(request: Request, global_access: str = Form(None), new_domain: str = Form(None)):
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    container.db.set_global_access(global_access == "on")
    if new_domain and new_domain.strip():
        container.db.add_allowed_domain(new_domain.strip())
    _write_auto_backup(container, "update_access")
    return RedirectResponse(url="/admin/", status_code=303)

@router.post("/access/remove")
async def remove_domain(request: Request, domain: str = Form(...)):
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    container.db.remove_allowed_domain(domain)
    _write_auto_backup(container, "remove_domain")
    return RedirectResponse(url="/admin/", status_code=303)

@router.get("/api/settings")
async def get_settings(request: Request):
    """Return all platform settings for admin display."""
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    settings_list = container.db.get_all_settings()
    # Mask secrets for display
    masked = []
    SECRET_KEYS = {"exam.litellm_api_key", "alerts.callmebot_apikey", "telegram.bot_token"}
    for s in settings_list:
        row = dict(s)
        if row["key"] in SECRET_KEYS and row["value"]:
            v = row["value"]
            row["value_display"] = v[:4] + "****" + v[-2:] if len(v) >= 8 else "***"
            row["is_secret"] = True
        else:
            row["value_display"] = row["value"]
            row["is_secret"] = False
        masked.append(row)
    return {"settings": masked}

@router.get("/api/settings/{key:path}")
async def get_setting(request: Request, key: str):
    """Return a single platform setting by key."""
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    value = container.db.get_setting(key)
    return {"key": key, "value": value or ""}


class SettingPayload(BaseModel):
    key: str
    value: str


@router.post("/api/settings")
async def save_setting(
    request: Request,
    key: str = Form(None),
    value: str = Form(None),
):
    """Save a single platform setting (form or JSON body)."""
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container

    # Support JSON body as fallback
    if key is None:
        try:
            body = await request.json()
            key = body.get("key", "")
            value = body.get("value", "")
        except Exception:
            raise HTTPException(400, "key is required (form or JSON)")

    key   = key.strip()
    value = value.strip()
    if not key:
        raise HTTPException(400, "key is required")
    container.db.set_setting(key, value)
    return {"ok": True, "key": key, "saved": True}

@router.post("/api/settings/bulk")
async def save_settings_bulk(request: Request):
    """
    Save multiple settings at once from a JSON body.
    Body: { "settings": { "key1": "value1", "key2": "value2" } }
    """
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    try:
        body = await request.json()
        settings_dict = body.get("settings", {})
    except Exception:
        raise HTTPException(400, "Invalid JSON body")
    if not isinstance(settings_dict, dict):
        raise HTTPException(400, "settings must be an object")
    saved = []
    for key, value in settings_dict.items():
        key   = str(key).strip()
        value = str(value).strip()
        if key:
            container.db.set_setting(key, value)
            saved.append(key)
    return {"ok": True, "saved_keys": saved}


def _truthy(value: str | bool | None) -> bool:
    if isinstance(value, bool):
        return value
    return str(value or "").strip().lower() in {"1", "true", "yes", "on"}


def _telegram_token(container) -> str:
    env_token = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
    if env_token:
        return env_token
    config_token = (container.settings.telegram.bot_token or "").strip()
    if config_token:
        return config_token
    return (container.db.get_setting("telegram.bot_token") or "").strip()


def _telegram_enabled(container) -> bool:
    env_enabled = os.getenv("TELEGRAM_BOT_ENABLED")
    if env_enabled is not None and env_enabled.strip():
        return _truthy(env_enabled)
    db_enabled = container.db.get_setting("telegram.bot_enabled")
    if db_enabled is not None:
        return _truthy(db_enabled)
    return bool(container.settings.telegram.bot_enabled)


@router.get("/api/telegram/status")
async def telegram_status(request: Request):
    """Return Telegram bot configuration status without exposing secrets."""
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    try:
        import telegram
        package_available = True
        package_version = getattr(telegram, "__version__", "")
    except Exception:
        package_available = False
        package_version = ""
    return {
        "enabled": _telegram_enabled(container) or bool(_telegram_token(container)),
        "token_set": bool(_telegram_token(container)),
        "package_available": package_available,
        "package_version": package_version,
        "process_model": "docker-compose telegram-bot service or python -m app.services.telegram_bot",
    }


@router.post("/api/telegram/test")
async def test_telegram_bot(request: Request):
    """Validate the saved Telegram token by calling getMe."""
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    token = _telegram_token(container)
    if not token:
        raise HTTPException(400, "Telegram bot token is not configured")
    try:
        from telegram import Bot
        bot = Bot(token=token)
        me = await bot.get_me()
        return {"ok": True, "username": me.username, "id": me.id}
    except Exception as e:
        raise HTTPException(400, f"Telegram token test failed: {e}")


@router.get("/api/alerts/config")
async def get_alert_config(request: Request):
    """Return current WhatsApp alert config status (no secrets exposed)."""
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    svc = container.alert_service
    return {
        "enabled":       svc._enabled(),
        "phone_set":     bool(svc._phone()),
        "apikey_set":    bool(svc._apikey()),
        "phone_preview": (svc._phone()[:4] + "****" + svc._phone()[-3:]) if len(svc._phone()) > 7 else "not set",
    }

@router.post("/api/alerts/test")
async def test_alert(request: Request):
    """Send a test WhatsApp message to verify configuration."""
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    ok = container.alert_service.send("🧪 *Test Alert*\nUnified Platform WhatsApp alerts are working correctly!")
    return {"ok": ok, "message": "Test message sent" if ok else "Failed — check CALLMEBOT_PHONE and CALLMEBOT_APIKEY in .env"}

@router.post("/api/alerts/notify-key")
async def notify_key_alert(request: Request, key_name: str = Form(...), expires_at: str = Form("")):
    """Manually trigger a new-key WhatsApp notification (e.g. after sharing key with user)."""
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    container.alert_service.notify_new_key(key_name=key_name, expires_at=expires_at or None)
    return {"ok": True}

@router.post("/api/extension/repack")
async def repack_extension(request: Request):
    """Manually trigger a fresh packaging of the original/admin browser extension."""
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    success = container.extension_service.package_extension()
    if not success:
        raise HTTPException(500, "Failed to package extension. Check backend logs.")
    return {"ok": True, "message": "Admin extension repackaged successfully"}


@router.get("/api/extension/download")
async def download_extension(request: Request, format: str = "zip", variant: str = "admin"):
    """Package and download admin or user extension artifacts."""
    denied = _admin_guard(request)
    if denied:
        return denied

    container = request.app.state.container
    normalized_variant = str(variant or "admin").strip().lower()
    filename = _extension_filename_for_format(format, normalized_variant)  # validate format/variant before work

    if normalized_variant == "user":
        success = container.extension_service.package_user_extension()
        if not success:
            raise HTTPException(500, "Failed to package user extension. Check backend logs.")
        artifact_path = _extension_artifact_path(container, filename, normalized_variant)
        if not artifact_path.exists():
            raise HTTPException(
                500,
                f"Packaged user extension file not found: {filename}",
            )
        media_type = _extension_media_type(filename)
        return FileResponse(path=artifact_path, media_type=media_type, filename=filename)

    success = container.extension_service.package_extension()
    if not success:
        raise HTTPException(500, "Failed to package extension. Check backend logs.")

    artifact_path = container.extension_service.output_dir / filename
    if not artifact_path.exists():
        raise HTTPException(500, f"Packaged extension file not found: {filename}")

    media_type = _extension_media_type(filename)
    return FileResponse(path=artifact_path, media_type=media_type, filename=filename)


@router.get("/api/userscripts")
async def list_userscripts(request: Request):
    """Admin listing for backend-controlled userscripts."""
    denied = _admin_guard(request)
    if denied:
        return denied
    
    _USERSCRIPTS_DIR.mkdir(parents=True, exist_ok=True)
    scripts: list[dict] = []
    index_path = (_USERSCRIPTS_DIR / "index.json").resolve()
    
    if index_path.is_file():
        try:
            entries = json.loads(index_path.read_text(encoding="utf-8"))
            if isinstance(entries, list):
                for entry in entries:
                    if not isinstance(entry, dict):
                        continue
                    file_name = str(entry.get("file", "")).strip()
                    if not file_name:
                        continue
                    file_path = (_USERSCRIPTS_DIR / file_name).resolve()
                    if _USERSCRIPTS_DIR not in file_path.parents or not file_path.is_file():
                        continue
                    code = file_path.read_text(encoding="utf-8")
                    parsed = parse_userscript_meta(code)
                    matches = entry.get("matches") if isinstance(entry.get("matches"), list) else parsed["matches"]
                    scripts.append({
                        "id": str(entry.get("id") or file_path.stem.replace(".user", "")),
                        "file": file_path.name,
                        "name": str(entry.get("name") or parsed["name"] or file_path.stem),
                        "version": str(entry.get("version") or parsed["version"]),
                        "enabled": bool(entry.get("enabled", True)),
                        "accessScope": _access_from_entry(entry)["accessScope"],
                        "plans": _access_from_entry(entry)["plans"],
                        "apiKeyIds": _access_from_entry(entry)["apiKeyIds"],
                        "services": _access_from_entry(entry)["services"],
                        "tags": _tags_from_entry(entry),
                        **_runtime_metadata_from_entry(entry),
                        "matches": matches,
                        "matches_count": len(matches),
                        "requires_count": len(entry.get("requires") if isinstance(entry.get("requires"), list) else parsed["requires"]),
                        "grants": entry.get("grants") if isinstance(entry.get("grants"), list) else parsed["grants"],
                        "runAt": str(entry.get("runAt") or parsed["runAt"]),
                        "diagnostics": parsed.get("diagnostics", {"warnings": [], "errors": []}),
                        "syncStatus": _userscript_sync_status(parsed),
                        "updated_at": file_path.stat().st_mtime,
                        "code": code,
                    })
        except Exception:
            pass
    else:
        for file_path in sorted(_USERSCRIPTS_DIR.glob("*.user.js")):
            if not file_path.is_file():
                continue
            code = file_path.read_text(encoding="utf-8")
            parsed = parse_userscript_meta(code)
            scripts.append({
                "id": file_path.stem.replace(".user", ""),
                "file": file_path.name,
                "name": parsed["name"] or file_path.stem,
                "version": parsed["version"],
                "enabled": True,
                "accessScope": "global",
                "plans": [],
                "apiKeyIds": [],
                "services": [],
                "tags": parsed.get("tags", []),
                "matches": parsed["matches"],
                "matches_count": len(parsed["matches"]),
                "requires_count": len(parsed["requires"]),
                "grants": parsed["grants"],
                "runAt": parsed["runAt"],
                "diagnostics": parsed.get("diagnostics", {"warnings": [], "errors": []}),
                "syncStatus": _userscript_sync_status(parsed),
                "updated_at": file_path.stat().st_mtime,
                "code": code,
            })
    
    return {"scripts": scripts, "count": len(scripts)}


@router.post("/api/userscripts/validate")
async def validate_userscript(request: Request):
    """Validate pasted userscript code without saving it."""
    denied = _admin_guard(request)
    if denied:
        return denied
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(400, "Invalid JSON body")

    code_body = body.get("code", "")
    meta = parse_userscript_meta(code_body)
    return {
        "ok": not bool(meta.get("diagnostics", {}).get("errors")),
        "meta": meta,
        "diagnostics": meta.get("diagnostics", {"warnings": [], "errors": []}),
        "syncStatus": _userscript_sync_status(meta),
    }


@router.post("/api/userscripts")
async def create_userscript(request: Request):
    """Create a new backend-controlled userscript."""
    denied = _admin_guard(request)
    if denied:
        return denied
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(400, "Invalid JSON body")
    
    code_body = body.get("code", "").strip()
    if not code_body:
        raise HTTPException(400, "code is required")
    
    meta = parse_userscript_meta(code_body)
    
    name = (body.get("name") or meta["name"] or "").strip()
    if not name:
        raise HTTPException(400, "Userscript name is required (either in headers or as a separate field)")
        
    uid = re.sub(r"\W+", "_", name.lower())
    version = (body.get("version") or meta["version"] or "0.0.0").strip()
    matches = body.get("matches") if body.get("matches") is not None else meta["matches"]
    if not isinstance(matches, list) or not matches:
        matches = ["<all_urls>"]
    runAt = (body.get("runAt") or meta["runAt"] or "document-idle").strip()
    
    final_code = _ensure_headers(name, version, matches, runAt, code_body)
    access = _access_from_body(body)
    tags = _tags_from_body(body, {"id": uid})
    _USERSCRIPTS_DIR.mkdir(parents=True, exist_ok=True)
    file_path = _USERSCRIPTS_DIR / f"{uid}.user.js"
    if file_path.exists():
        raise HTTPException(400, f"Userscript with id {uid} already exists")
    file_path.write_text(final_code, encoding="utf-8")
    runtime_metadata = _runtime_metadata_from_body(body, {"id": uid})
    _update_index({uid: {**access, "tags": tags, **runtime_metadata}})
    final_meta = parse_userscript_meta(final_code)
    return {
        "ok": True,
        "id": uid,
        "accessScope": access["accessScope"],
        "plans": access["plans"],
        "apiKeyIds": access["apiKeyIds"],
        "services": access["services"],
        "tags": tags,
        **runtime_metadata,
        "meta": final_meta,
        "diagnostics": final_meta.get("diagnostics", {"warnings": [], "errors": []}),
        "syncStatus": _userscript_sync_status(final_meta),
    }


@router.put("/api/userscripts/{uid}")
async def update_userscript(request: Request, uid: str):
    """Update an existing backend-controlled userscript."""
    denied = _admin_guard(request)
    if denied:
        return denied
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(400, "Invalid JSON body")
    
    code_body = body.get("code", "").strip()
    if not code_body:
        raise HTTPException(400, "code is required")
    
    meta = parse_userscript_meta(code_body)
    
    name = (body.get("name") or meta["name"] or "").strip()
    if not name:
        raise HTTPException(400, "Userscript name is required (either in headers or as a separate field)")
    
    version = (body.get("version") or meta["version"] or "0.0.0").strip()
    matches = body.get("matches") if body.get("matches") is not None else meta["matches"]
    if not isinstance(matches, list) or not matches:
        matches = ["<all_urls>"]
    runAt = (body.get("runAt") or meta["runAt"] or "document-idle").strip()
    
    final_code = _ensure_headers(name, version, matches, runAt, code_body)
    access = _access_from_body(body)
    tags = _tags_from_body(body, {"id": uid})
    file_path = _USERSCRIPTS_DIR / f"{uid}.user.js"
    if not file_path.exists():
        raise HTTPException(404, f"Userscript {uid} not found")
    file_path.write_text(final_code, encoding="utf-8")
    runtime_metadata = _runtime_metadata_from_body(body, {"id": uid})
    _update_index({uid: {**access, "tags": tags, **runtime_metadata}})
    final_meta = parse_userscript_meta(final_code)
    return {
        "ok": True,
        "id": uid,
        "accessScope": access["accessScope"],
        "plans": access["plans"],
        "apiKeyIds": access["apiKeyIds"],
        "services": access["services"],
        "tags": tags,
        **runtime_metadata,
        "meta": final_meta,
        "diagnostics": final_meta.get("diagnostics", {"warnings": [], "errors": []}),
        "syncStatus": _userscript_sync_status(final_meta),
    }


@router.patch("/api/userscripts/{uid}/enabled")
async def set_userscript_enabled(request: Request, uid: str):
    """Enable or disable a backend-controlled userscript without rewriting its code."""
    denied = _admin_guard(request)
    if denied:
        return denied
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(400, "Invalid JSON body")

    file_path = _USERSCRIPTS_DIR / f"{uid}.user.js"
    if not file_path.exists():
        raise HTTPException(404, f"Userscript {uid} not found")
    enabled = bool(body.get("enabled"))
    _update_index({uid: {"enabled": enabled}})
    return {"ok": True, "id": uid, "enabled": enabled}


@router.delete("/api/userscripts/{uid}")
async def delete_userscript(request: Request, uid: str):
    """Delete a backend-controlled userscript."""
    denied = _admin_guard(request)
    if denied:
        return denied
    file_path = _USERSCRIPTS_DIR / f"{uid}.user.js"
    if not file_path.exists():
        raise HTTPException(404, f"Userscript {uid} not found")
    file_path.unlink()
    _update_index()
    return {"ok": True}


# ── QR Code Image Upload ──────────────────────────────────────────────────────

_QR_DIR = get_project_root() / "data" / "uploads"
_QR_DIR.mkdir(parents=True, exist_ok=True)

@router.post("/api/settings/upload-qr")
async def upload_qr_image(request: Request, file: UploadFile = File(...)):
    """Upload a QR code image for UPI payments. Saves as data/uploads/qr_code.png"""
    denied = _admin_guard(request)
    if denied:
        return denied
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(400, "Only image files allowed")
    
    ext = file.filename.rsplit(".", 1)[-1].lower() if file.filename else "png"
    if ext not in ("png", "jpg", "jpeg", "gif", "webp"):
        ext = "png"
    filename = f"qr_code.{ext}"
    filepath = _QR_DIR / filename
    
    content = await file.read()
    filepath.write_bytes(content)
    
    # Save the URL to settings
    container = request.app.state.container
    qr_url = f"/admin/api/settings/qr-image"
    container.db.set_setting("payment.qr_image_url", qr_url)
    
    return {"ok": True, "url": qr_url, "filename": filename}


@router.get("/api/settings/qr-image")
async def get_qr_image(request: Request):
    """Serve the uploaded QR code image."""
    denied = _admin_guard(request)
    if denied:
        return denied
    for ext in ("png", "jpg", "jpeg", "gif", "webp"):
        fp = _QR_DIR / f"qr_code.{ext}"
        if fp.exists():
            media = { "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg",
                      "gif": "image/gif", "webp": "image/webp" }
            return FileResponse(fp, media_type=media.get(ext, "image/png"))
    raise HTTPException(404, "No QR image uploaded")


@router.post("/api/settings/plans/{plan_id}/upload-qr")
async def upload_plan_qr_image(request: Request, plan_id: int, file: UploadFile = File(...)):
    """Upload a QR code image for a specific subscription plan."""
    denied = _admin_guard(request)
    if denied:
        return denied
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(400, "Only image files allowed")

    ext = file.filename.rsplit(".", 1)[-1].lower() if file.filename else "png"
    if ext not in ("png", "jpg", "jpeg", "gif", "webp"):
        ext = "png"

    for old_ext in ("png", "jpg", "jpeg", "gif", "webp"):
        old = _QR_DIR / f"qr_plan_{plan_id}.{old_ext}"
        if old.exists():
            old.unlink()

    filename = f"qr_plan_{plan_id}.{ext}"
    filepath = _QR_DIR / filename
    content = await file.read()
    filepath.write_bytes(content)

    container = request.app.state.container
    qr_url = f"/admin/api/settings/plans/{plan_id}/qr-image"
    container.db.set_setting(f"payment.qr_image_url_plan_{plan_id}", qr_url)

    return {"ok": True, "url": qr_url, "filename": filename}


@router.get("/api/settings/plans/{plan_id}/qr-image")
async def get_plan_qr_image(request: Request, plan_id: int):
    """Serve the uploaded QR code image for a specific subscription plan."""
    denied = _admin_guard(request)
    if denied:
        return denied
    for ext in ("png", "jpg", "jpeg", "gif", "webp"):
        fp = _QR_DIR / f"qr_plan_{plan_id}.{ext}"
        if fp.exists():
            media = { "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg",
                      "gif": "image/gif", "webp": "image/webp" }
            return FileResponse(fp, media_type=media.get(ext, "image/png"))
    raise HTTPException(404, "No plan QR image uploaded")
