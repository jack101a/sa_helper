import json
import logging

logger = logging.getLogger(__name__)

def validate_automation_method_payload(payload: dict) -> list[str]:
    """Validate the JSON payload of an automation method."""
    errors = []
    
    if not isinstance(payload, dict):
        return ["Payload must be a JSON object"]
    
    if "version" not in payload:
        errors.append("Missing required field: 'version'")
    
    steps = payload.get("steps")
    if not isinstance(steps, list) or not steps:
        errors.append("'steps' must be a non-empty list")
        return errors
    
    if len(steps) > 10:
        errors.append("Too many steps (max 10 allowed)")
    
    for i, step in enumerate(steps):
        if not isinstance(step, dict):
            prefix = f"Step {i+1} (unknown): "
            errors.append(f"{prefix}Must be a JSON object")
            continue

        prefix = f"Step {i+1} ({step.get('id', 'unknown')}): "
            
        if not step.get("id"):
            errors.append(f"{prefix}Missing required field: 'id'")
            
        if not step.get("label"):
            errors.append(f"{prefix}Missing required field: 'label'")
            
        code = step.get("code")
        if not isinstance(code, str) or not code.strip():
            errors.append(f"{prefix}Missing or empty required field: 'code'")
        elif len(code) > 200 * 1024:
            errors.append(f"{prefix}Code too large (max 200 KB)")
            
        wait = step.get("wait_after_ms", 0)
        if not isinstance(wait, int) or wait < 0:
            errors.append(f"{prefix}'wait_after_ms' must be a non-negative integer")
            
    return errors

def compose_dynamic_stall_flow(payload: dict) -> str:
    """
    Compose the dynamic STALL flow script from the payload.
    This generates a wrapper script that executes the individual steps sequentially.
    """
    steps = payload.get("steps", [])
    
    # Base utilities that must be present in the execution environment
    # These match the _compose_stall_flow_payload in routes.py
    js_parts = [
        "const __stallSleep = function(ms) {",
        "    return new Promise(resolve => setTimeout(resolve, ms));",
        "};",
        "const __stallAjaxActive = function() {",
        "    try {",
        "        if (typeof window.$ !== 'undefined' && Number.isFinite(Number(window.$.active))) {",
        "            return Number(window.$.active);",
        "        }",
        "    } catch (_) {}",
        "    return 0;",
        "};",
        "const __stallWaitForAjaxIdle = async function(label, timeoutMs, beforeActive) {",
        "    const startedAt = Date.now();",
        "    let sawBusy = false;",
        "    while (Date.now() - startedAt < timeoutMs) {",
        "        const active = __stallAjaxActive();",
        "        if (active > beforeActive || active > 0) sawBusy = true;",
        "        const elapsed = Date.now() - startedAt;",
        "        if (elapsed >= 1000 && ((sawBusy && active === 0) || (!sawBusy && elapsed >= 2500))) return;",
        "        await __stallSleep(250);",
        "    }",
        "    console.warn('[STALL Flow] AJAX wait timed out for ' + label);",
        "};",
        "const __stallRunPayload = async function(label, code) {",
        "    console.log('[STALL Flow] Running ' + label);",
        "    const beforeActive = __stallAjaxActive();",
        "    const runner = new Function(code);",
        "    const result = runner();",
        "    if (result && typeof result.then === 'function') await result;",
        "    await __stallSleep(500);",
        "    await __stallWaitForAjaxIdle(label, 15000, beforeActive);",
        "};"
    ]
    
    for step in steps:
        step_id = step.get("id")
        code = step.get("code", "")
        wait_ms = step.get("wait_after_ms", 0)
        
        # Escape the code for inclusion in a JS string literal
        code_literal = json.dumps(code)
        
        js_parts.append(f"await __stallRunPayload({json.dumps(step_id)}, {code_literal});")
        if wait_ms > 0:
            js_parts.append(f"await __stallSleep({wait_ms});")
            
    js_parts.append("return { ok: true, step: 'stall-flow' };")
    
    return "\n".join(js_parts)
