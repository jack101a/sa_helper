"""Shared helpers for v1 route modules."""

from __future__ import annotations

import base64
import json
import logging
import re
import time
import uuid
from collections import deque
from datetime import datetime, timezone
from pathlib import Path

from fastapi import HTTPException, Request

from app.core.database import Database
from app.core.paths import get_project_root
from app.core.userscript_utils import parse_userscript_meta

logger = logging.getLogger(__name__)

_REPORT_WINDOW_SECONDS = 60
_REPORT_MAX_PER_WINDOW = 20
# Maximum report upload size: 5 MB of raw binary (before base64 expansion ~3.75 MB)
_REPORT_MAX_BYTES = 5 * 1024 * 1024
_PROJECT_ROOT = get_project_root()
_DATASETS_DIR = (_PROJECT_ROOT / "backend" / "datasets").resolve()

# Per-(key_id, domain) sliding-window deques for report rate limiting.
# Pruned periodically to prevent unbounded memory growth.
_report_buckets: dict[tuple[int, str], deque[float]] = {}
_REPORT_PRUNE_INTERVAL = 300  # seconds between prune passes
_last_prune: float = 0.0

_AUTOMATION_SCRIPT_IDS = {"step3", "step4", "stall-flow"}
_STALL_CORE_USERSCRIPT_DEFAULTS = {
    "authentication_handler": {
        "accessScope": "global",
        "services": [],
    },
    "bypass_sarathi_restrictions_v2": {
        "accessScope": "global",
        "services": [],
    },
    "enable_all_form_fields_for_stall": {
        "accessScope": "global",
        "services": [],
    },
}


def ensure_master_key(request: Request) -> None:
    """Raise 403 if the current API key is not a master key."""
    key_record = request.state.api_key_record
    if not key_record or key_record.get("key_type") != "master":
        raise HTTPException(403, "Master key required for this administrative action.")


def get_request_entitlements(request: Request) -> dict:
    """Return effective key entitlements for legacy and user-linked keys."""
    key_record = request.state.api_key_record
    if not key_record:
        return {"plan_name": "Standard", "mobile": "", "telegram_id": "", "services": {}}

    if bool(getattr(request.state, "is_user_key", False)):
        try:
            from app.core.db import get_session
            from app.core.models import SubscriptionPlan, User, UserSubscription

            session = get_session()
            try:
                user = session.query(User).filter(User.id == int(key_record["user_id"])).first()
                sub = (
                    session.query(UserSubscription)
                    .filter(
                        UserSubscription.user_id == int(key_record["user_id"]),
                        UserSubscription.status == "active",
                    )
                    .order_by(UserSubscription.created_at.desc())
                    .first()
                )
                plan = session.query(SubscriptionPlan).filter(SubscriptionPlan.id == sub.plan_id).first() if sub else None
                return {
                    "plan_name": plan.name if plan else "Standard",
                    "mobile": user.mobile_number if user and user.mobile_number else "",
                    "telegram_id": user.telegram_user_id if user and user.telegram_user_id else "",
                    "services": (plan.allowed_services or {}) if plan else {},
                }
            finally:
                session.close()
        except Exception:
            return {"plan_name": "Standard", "mobile": "", "telegram_id": "", "services": {}}

    return request.app.state.container.db.get_api_key_entitlements(int(key_record["id"]))


def ensure_service_allowed(request: Request, service: str) -> None:
    """Raise 403 when the current key is not entitled to a service."""
    key_record = request.state.api_key_record
    if not key_record:
        raise HTTPException(401, "API key required")
    if key_record.get("key_type") == "master":
        return
    entitlements = get_request_entitlements(request)
    services = entitlements.get("services") or {}
    if services.get(service) is False:
        raise HTTPException(403, f"{service} service is not enabled for this API key")


def prune_report_buckets() -> None:
    """Remove expired entries from _report_buckets to prevent memory leaks."""
    global _last_prune
    now = time.monotonic()
    if now - _last_prune < _REPORT_PRUNE_INTERVAL:
        return
    _last_prune = now
    dead_keys = []
    for key, q in list(_report_buckets.items()):
        while q and (now - q[0]) > _REPORT_WINDOW_SECONDS:
            q.popleft()
        if not q:
            dead_keys.append(key)
    for key in dead_keys:
        _report_buckets.pop(key, None)


def allow_report(key_id: int, domain: str) -> bool:
    prune_report_buckets()
    now = time.monotonic()
    bucket_key = (key_id, domain)
    q = _report_buckets.setdefault(bucket_key, deque())
    while q and (now - q[0]) > _REPORT_WINDOW_SECONDS:
        q.popleft()
    if len(q) >= _REPORT_MAX_PER_WINDOW:
        return False
    q.append(now)
    return True


def write_json_atomic(path: Path, data: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_name(f"{path.name}.tmp")
    with tmp_path.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    tmp_path.replace(path)


def save_exam_offline_dataset(
    *,
    question_image,
    option_images: list[object | None],
    question_hash: str,
    question_phash: str,
    question_text: str,
    option_texts: list[str],
    option_hashes: list[str],
    option_phashes: list[str],
    correct_option: int,
    correct_option_hash: str,
    correct_option_phash: str,
    correct_option_text: str,
    domain: str | None,
    method: str | None,
    question_num: int | None,
    learn_result: dict,
) -> Path:
    dataset_root = (_PROJECT_ROOT / "data" / "exam_offline").resolve()
    folder_name = re.sub(r"[^A-Za-z0-9._-]+", "_", question_hash).strip("_") or uuid.uuid4().hex
    question_dir = dataset_root / "questions" / folder_name
    question_dir.mkdir(parents=True, exist_ok=True)

    now_iso = datetime.now(timezone.utc).isoformat()
    question_rel = f"questions/{folder_name}/question.png"
    question_image.save(dataset_root / question_rel, format="PNG")

    options = []
    for idx, opt_img in enumerate(option_images, start=1):
        rel_path = ""
        if opt_img is not None:
            rel_path = f"questions/{folder_name}/option_{idx}.png"
            opt_img.save(dataset_root / rel_path, format="PNG")
        options.append({
            "option": idx,
            "image": rel_path,
            "text": option_texts[idx - 1] if idx - 1 < len(option_texts) else "",
            "hash": option_hashes[idx - 1] if idx - 1 < len(option_hashes) else "",
            "phash": option_phashes[idx - 1] if idx - 1 < len(option_phashes) else "",
            "is_correct": idx == correct_option,
        })

    metadata = {
        "schema_version": 1,
        "saved_at": now_iso,
        "question_hash": question_hash,
        "question_phash": question_phash,
        "question_num": question_num,
        "domain": domain,
        "source": "exam_feedback",
        "method": method,
        "question_image": question_rel,
        "question_text": question_text,
        "options": options,
        "answer": {
            "correct_option": correct_option,
            "correct_option_hash": correct_option_hash,
            "correct_option_phash": correct_option_phash,
            "correct_option_text": correct_option_text,
        },
        "learning": {
            "action": learn_result.get("action"),
            "confidence": learn_result.get("confidence"),
            "seen_count": learn_result.get("seen_count"),
            "verified_count": learn_result.get("verified_count"),
            "status": learn_result.get("status"),
        },
    }
    write_json_atomic(question_dir / "metadata.json", metadata)

    index_path = dataset_root / "index.json"
    try:
        with index_path.open("r", encoding="utf-8") as f:
            index = json.load(f)
    except Exception:
        index = {"schema_version": 1, "created_at": now_iso, "questions": {}}
    if not isinstance(index, dict):
        index = {"schema_version": 1, "created_at": now_iso, "questions": {}}
    questions = index.setdefault("questions", {})
    if not isinstance(questions, dict):
        questions = {}
        index["questions"] = questions

    previous = questions.get(question_hash) if isinstance(questions.get(question_hash), dict) else {}
    questions[question_hash] = {
        **previous,
        "question_hash": question_hash,
        "question_phash": question_phash,
        "folder": f"questions/{folder_name}",
        "metadata": f"questions/{folder_name}/metadata.json",
        "question_image": question_rel,
        "option_images": [opt["image"] for opt in options],
        "correct_option": correct_option,
        "correct_option_hash": correct_option_hash,
        "correct_option_phash": correct_option_phash,
        "domain": domain,
        "question_num": question_num,
        "confidence": learn_result.get("confidence"),
        "seen_count": learn_result.get("seen_count"),
        "verified_count": learn_result.get("verified_count"),
        "status": learn_result.get("status"),
        "last_saved_at": now_iso,
        "created_at": previous.get("created_at", now_iso),
    }
    index["updated_at"] = now_iso
    write_json_atomic(index_path, index)
    return question_dir


def save_exam_offline_dataset_safe(**kwargs) -> None:
    try:
        saved_dir = save_exam_offline_dataset(**kwargs)
        logger.info("exam_feedback_offline_saved", extra={
            "context": {
                "hash": str(kwargs.get("question_hash", ""))[:12],
                "path": str(saved_dir),
            }
        })
    except Exception as e:
        logger.warning("exam_feedback_offline_save_failed", extra={"context": {"error": str(e)}})


def export_learned_to_json_safe(container) -> None:
    try:
        container.exam_service.export_learned_to_json()
    except Exception as e:
        logger.warning("exam_feedback_export_failed", extra={"context": {"error": str(e)}})


def userscript_sync_status(meta: dict) -> str:
    diagnostics = meta.get("diagnostics") if isinstance(meta, dict) else {}
    errors = diagnostics.get("errors") if isinstance(diagnostics, dict) else []
    return "error" if errors else "ready"


def normalize_userscript_plan(value: object) -> str:
    return re.sub(r"[^a-z0-9]+", "_", str(value or "").strip().lower()).strip("_")


def userscript_string_list(value: object) -> list[str]:
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    if isinstance(value, str):
        return [item.strip() for item in re.split(r"[,;\n]+", value) if item.strip()]
    return []


def userscript_int_list(value: object) -> list[int]:
    items = value if isinstance(value, list) else userscript_string_list(value)
    out: list[int] = []
    for item in items:
        try:
            out.append(int(item))
        except (TypeError, ValueError):
            continue
    return out


def userscript_access(entry: dict) -> dict:
    defaults = _STALL_CORE_USERSCRIPT_DEFAULTS.get(str(entry.get("id") or "").strip()) or {}
    scope = str(
        entry.get("accessScope")
        or entry.get("access_scope")
        or entry.get("scope")
        or defaults.get("accessScope")
        or "global"
    ).strip().lower()
    if scope in {"all", "public"}:
        scope = "global"
    elif scope in {"plans"}:
        scope = "plan"
    elif scope in {"keys", "user", "users"}:
        scope = "key"
    elif scope not in {"global", "plan", "key", "custom", "service"}:
        scope = "global"
    return {
        "accessScope": scope,
        "plans": userscript_string_list(entry.get("plans") or entry.get("plan_names") or entry.get("allowed_plans")),
        "apiKeyIds": userscript_int_list(entry.get("apiKeyIds") or entry.get("api_key_ids") or entry.get("allowed_api_key_ids")),
        "services": userscript_string_list(entry.get("services") or entry.get("service") or entry.get("serviceNames") or entry.get("service_names") or defaults.get("services")),
    }


def userscript_allowed_for_key(entry: dict, key_record: dict, entitlements: dict) -> bool:
    if not bool(entry.get("enabled", True)):
        return False
    if key_record.get("key_type") == "master":
        return True

    access = userscript_access(entry)
    scope = access["accessScope"]
    if scope == "global":
        return True
    if scope == "plan":
        allowed_plans = {normalize_userscript_plan(item) for item in access["plans"]}
        current_plan = normalize_userscript_plan(entitlements.get("plan_name") or "")
        return bool(current_plan and current_plan in allowed_plans)
    if scope == "key":
        try:
            return int(key_record["id"]) in set(access["apiKeyIds"])
        except (KeyError, TypeError, ValueError):
            return False
    if scope == "service":
        services = entitlements.get("services") or {}
        service_names = access.get("services") or []
        if not service_names:
            service_names = ["custom"]
        return any(name in services and services.get(name) is not False for name in service_names)
    if scope == "custom":
        matched = False
        allowed_plans = {normalize_userscript_plan(item) for item in access["plans"]}
        current_plan = normalize_userscript_plan(entitlements.get("plan_name") or "")
        if current_plan and current_plan in allowed_plans:
            matched = True
        try:
            if int(key_record["id"]) in set(access["apiKeyIds"]):
                matched = True
        except (KeyError, TypeError, ValueError):
            pass
        services = entitlements.get("services") or {}
        if any(name in services and services.get(name) is not False for name in (access.get("services") or [])):
            matched = True
        return matched
    return False


def dynamic_automation_enabled(container) -> bool:
    """Check if dynamic automation methods are enabled in platform settings."""
    return container.db.get_setting("automation.dynamic_methods_enabled", "false").lower() in ("1", "true", "yes", "on")


def read_automation_script(step_id: str) -> str:
    script_path = _PROJECT_ROOT / "data" / "automation_scripts" / f"{step_id}.js"
    if not script_path.exists():
        logger.error("automation_script_not_found", extra={"context": {"path": str(script_path)}})
        raise HTTPException(404, f"Automation script for {step_id} not found")
    return script_path.read_text(encoding="utf-8")


def compose_stall_flow_payload(step3_code: str, step4_code: str) -> str:
    step3_literal = json.dumps(step3_code)
    step4_literal = json.dumps(step4_code)
    return f"""
const __stallSleep = function(ms) {{
    return new Promise(resolve => setTimeout(resolve, ms));
}};
const __stallAjaxActive = function() {{
    try {{
        if (typeof window.$ !== 'undefined' && Number.isFinite(Number(window.$.active))) {{
            return Number(window.$.active);
        }}
    }} catch (_) {{}}
    return 0;
}};
const __stallWaitForAjaxIdle = async function(label, timeoutMs, beforeActive) {{
    const startedAt = Date.now();
    let sawBusy = false;
    while (Date.now() - startedAt < timeoutMs) {{
        const active = __stallAjaxActive();
        if (active > beforeActive || active > 0) sawBusy = true;
        const elapsed = Date.now() - startedAt;
        if (elapsed >= 1000 && ((sawBusy && active === 0) || (!sawBusy && elapsed >= 2500))) return;
        await __stallSleep(250);
    }}
    console.warn('[STALL Flow] AJAX wait timed out for ' + label);
}};
const __stallRunPayload = async function(label, code) {{
    console.log('[STALL Flow] Running ' + label);
    const beforeActive = __stallAjaxActive();
    const runner = new Function(code);
    const result = runner();
    if (result && typeof result.then === 'function') await result;
    await __stallSleep(500);
    await __stallWaitForAjaxIdle(label, 15000, beforeActive);
}};
await __stallRunPayload('step3', {step3_literal});
await __stallSleep(5000);
await __stallRunPayload('step4', {step4_literal});
return {{ ok: true, step: 'stall-flow' }};
""".strip()
