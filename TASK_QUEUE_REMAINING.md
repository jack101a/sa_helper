# TASK_QUEUE_REMAINING.md — Remaining ~75 Items Safe Implementation Plan

## For Agent: deepseek-v4-flash
## Mode: BUILD (read + edit files, run verify commands)
## Rule: ONLY implement items listed here. NEVER touch items in the DEFERRED section.

---

## HOW TO WORK
1. Read this file and TASK.md
2. Pick the first pending task in the current phase
3. Update TASK.md with that task's details
4. Read the target file(s) before editing
5. Make minimal surgical edits
6. Verify the change (run the verify command listed)
7. Update STATE.md
8. Mark task complete in this file
9. Repeat until all tasks are done

---

## ⛔ DEFERRED — DO NOT TOUCH THESE

These items are SKIPPED intentionally. Both review agents agree they would break things:

### Extension (too risky for now):
- **DO NOT change `postMessage('*')`** in any extension file (23 calls across 5 files — could break captcha/exam/autofill/STALL/VCAM cross-frame communication)
- **DO NOT remove `new Function(code)`** in background.js/userscript_engine.js (could break existing userscripts)
- **DO NOT reduce `<all_urls>` scope** in manifest.json (would break userscript engine)
- **DO NOT scope dialog/fetch/XHR overrides** to target domain (captcha images may come from CDN)
- **DO NOT add sender origin validation** to message handlers (could block legitimate messages)
- **DO NOT merge duplicate vcam getUserMedia overrides** (two different implementations, behavior undefined if merged)
- **DO NOT scope `browsingData.remove({since:0})`** (nuclear restart intentionally wipes everything)

### Architecture (separate projects):
- **DO NOT migrate legacy DB to SQLAlchemy** (separate 2-4 week project)
- **DO NOT add TypeScript** to frontend/extension (separate 2-4 week project)
- **DO NOT rewrite Alembic migrations** (current `Base.metadata.create_all()` workaround works)
- **DO NOT merge Dockerfiles** (root and infra serve different purposes)
- **DO NOT merge docker-compose files** (infra depends on external network)
- **DO NOT refactor `main.py` module-level side effects** (touches entire DI container)
- **DO NOT fix weak session cookie** (would invalidate all admin sessions)
- **DO NOT run `git filter-branch` or `git rm --cached`** on secrets

### VM Integration (separate 3-4 week project):
- **DO NOT implement any VM integration phase**

---

# PHASE 1: Trivial Fixes (8 tasks) — ~1 hour

These are zero-risk, can be done in any order.

## T1 — Add `TELEGRAM_BOT_TOKEN` to `.env.example`
- **File:** `/workspace/sa_helper/config/.env.example`
- **Change:** Add line `TELEGRAM_BOT_TOKEN=` (empty, user fills in)
- **Verify:** `grep "TELEGRAM_BOT_TOKEN" /workspace/sa_helper/config/.env.example` returns match
- **Status:** pending

## T2 — Remove unused variables in `package_extension.ps1`
- **File:** `/workspace/sa_helper/scripts/package_extension.ps1`
- **Change:** Remove `$SourceDir` and `$ZipFile` variable declarations (declared but never used)
- **Verify:** `python3 -c "import re; t=open('/workspace/sa_helper/scripts/package_extension.ps1').read(); assert '$SourceDir' not in t or 'Write-Host' in t.split('$SourceDir')[1][:50]"` — no unused $SourceDir or $ZipFile
- **Status:** pending

## T3 — Fix Firefox manifest (service_worker → scripts)
- **File:** `/workspace/sa_helper/extension/manifest_firefox.json`
- **Change:** Replace `"service_worker": "background.js"` with `"scripts": ["background.js"]` (Firefox MV3 doesn't support service_worker key)
- **Verify:** `grep "service_worker" /workspace/sa_helper/extension/manifest_firefox.json` returns NO matches
- **Status:** pending

## T4 — Fix `test_services.py` TemporaryDirectory use-after-free
- **File:** `/workspace/sa_helper/backend/tests/test_services.py`
- **Change:** Move `self.service = ExamService(...)` OUTSIDE the `with tempfile.TemporaryDirectory() as tmp:` block. Use `self.tmp_dir_obj = tempfile.TemporaryDirectory()` and `self.tmp_dir = self.tmp_dir_obj.name`, then clean up in `tearDown()`.
- **Verify:** `python3 -m py_compile /workspace/sa_helper/backend/tests/test_services.py` passes
- **Status:** pending

## T5 — Fix `useKeyboardShortcuts.js` cleanup
- **File:** `/workspace/sa_helper/frontend/src/app/hooks/useKeyboardShortcuts.js`
- **Change:** Ensure the `useEffect` that adds the keydown listener returns a cleanup function that calls `document.removeEventListener`. Also memoize the `shortcuts` object with `useMemo` so it doesn't change identity every render.
- **Verify:** `grep "removeEventListener" /workspace/sa_helper/frontend/src/app/hooks/useKeyboardShortcuts.js` returns match
- **Status:** pending

## T6 — Fix `useTheme.js` to memoize returned functions
- **File:** `/workspace/sa_helper/frontend/src/app/hooks/useTheme.js`
- **Change:** Wrap `iconBtn`, `tabButton`, `viewSwitcherBtn` in `useCallback` so they don't get new references on every render.
- **Verify:** `grep "useCallback" /workspace/sa_helper/frontend/src/app/hooks/useTheme.js` returns matches
- **Status:** pending

## T7 — Fix `App.jsx` loading state
- **File:** `/workspace/sa_helper/frontend/src/app/App.jsx`
- **Change:** The `loading` variable should check ALL queries, not just bootstrap. Add `|| autofill.isLoading || captcha.isLoading || exam.isLoading || userscripts.isLoading` to the loading check.
- **Verify:** `grep "autofill.isLoading" /workspace/sa_helper/frontend/src/app/App.jsx` returns match
- **Status:** pending

## T8 — Fix `content.js` setInterval handle
- **File:** `/workspace/sa_helper/extension/content.js`
- **Change:** Store the `setInterval` return value on line 12 in a variable so it can be cleared later. Add a cleanup mechanism (e.g., listen for a disable message).
- **Verify:** `grep "setInterval" /workspace/sa_helper/extension/content.js` shows stored handle (not bare `setInterval(function`)
- **Status:** pending

---

# PHASE 2: Low-Risk Backend Fixes (12 tasks) — ~3 hours

## T9 — Fix `solver_service.py` CancelledError orphan (B-001)
- **File:** `/workspace/sa_helper/backend/app/services/solver_service.py`
- **Change:** In the `_worker_loop` method, inside the `except CancelledError` block, call `future.set_exception(CancelledError())` on the job's future before re-raising. This ensures callers don't hang forever when `stop()` is called during in-flight requests.
- **Verify:** `python3 -m py_compile` passes. CancelledError handler resolves the future.
- **Status:** pending

## T10 — Fix `exam_service.py` thread safety (B-002)
- **File:** `/workspace/sa_helper/backend/app/services/exam_service.py`
- **Change:** Add `self._sign_lock = threading.Lock()` in `__init__`. Wrap `self._sign_phash` mutation and `_save_phash_file()` call in `_match_sign_hash` with `with self._sign_lock:`.
- **Verify:** `python3 -m py_compile` passes. `_sign_phash` accesses are inside lock.
- **Status:** pending

## T11 — Fix `exam_service.py` max_tokens (B-030)
- **File:** `/workspace/sa_helper/backend/app/services/exam_service.py`
- **Change:** Change `max_tokens: 5` to `max_tokens: 10` in the LLM call (line ~499). This prevents truncation before the answer digit is output.
- **Verify:** `grep "max_tokens" /workspace/sa_helper/backend/app/services/exam_service.py` shows value >= 10
- **Status:** pending

## T12 — Fix `onnx_model.py` blocking inference (B-007)
- **File:** `/workspace/sa_helper/backend/app/ai/onnx_model.py`
- **Change:** In the `async def solve` method, wrap the blocking `_session.run()` call with `await asyncio.to_thread(self._session.run, ...)` to offload CPU-bound inference to a thread pool. Also wrap `_preprocess` if it does blocking PIL ops.
- **Verify:** `python3 -m py_compile` passes. `_session.run()` is inside `asyncio.to_thread`.
- **Status:** pending

## T13 — Fix `user_key_service.py` race condition (B-017)
- **File:** `/workspace/sa_helper/backend/app/services/user_key_service.py`
- **Change:** In `rotate_key`, use `UPDATE ... WHERE status = 'active'` instead of read-then-write. Or add `self._lock = threading.Lock()` and wrap the deactivate-old + create-new sequence.
- **Verify:** `python3 -m py_compile` passes. Deactivate and create are atomic.
- **Status:** pending

## T14 — Fix `usage_cycle_service.py` detached session (B-018)
- **File:** `/workspace/sa_helper/backend/app/services/usage_cycle_service.py`
- **Change:** In `check_quota`, don't open/close a separate session. Accept a session parameter from the caller. The caller (auth middleware) should pass its own session.
- **Verify:** `python3 -m py_compile` passes. `get_or_create_cycle` accepts session parameter.
- **Status:** pending

## T15 — Fix `usage_cycle_service.py` atomic increment (B-019)
- **File:** `/workspace/sa_helper/backend/app/services/usage_cycle_service.py`
- **Change:** Replace read-then-write with `UPDATE usage_cycles SET used_count = used_count + 1 WHERE ... AND used_count < monthly_limit`. Check `rowcount` to see if update succeeded (under limit) or was skipped (over limit).
- **Verify:** `python3 -m py_compile` passes. Increment uses single UPDATE with WHERE clause.
- **Status:** pending

## T16 — Fix `subscription_service.py` user block bypass (B-021)
- **File:** `/workspace/sa_helper/backend/app/services/subscription_service.py`
- **Change:** In `create_subscription`, before setting `user.status = "active"`, check if `user.status == "blocked"`. If blocked, raise an error or skip the status change.
- **Verify:** `python3 -m py_compile` passes. Block check exists before status change.
- **Status:** pending

## T17 — Fix `key_service.py` enabled field type crash (B-027)
- **File:** `/workspace/sa_helper/backend/app/services/key_service.py`
- **Change:** Change `int(record.get("enabled", 0))` to `int(bool(record.get("enabled", 0)))` to handle boolean True/False values from SQLite.
- **Verify:** `python3 -m py_compile` passes. `bool()` wrapper added.
- **Status:** pending

## T18 — Fix `telegram_bot.py` blocking OCR (B-028)
- **File:** `/workspace/sa_helper/backend/app/services/telegram_bot.py`
- **Change:** In `photo_handler` (async), wrap the `_ocr_screenshot_full(filepath)` call with `await asyncio.to_thread(_ocr_screenshot_full, filepath)` to offload OCR to a thread pool.
- **Verify:** `python3 -m py_compile` passes. OCR call is inside `asyncio.to_thread`.
- **Status:** pending

## T19 — Fix `payments.py` path traversal (B-025/S-27)
- **File:** `/workspace/sa_helper/backend/app/api/admin_routes/payments.py`
- **Change:** In `get_payment_screenshot`, validate that `Path(payment.payment_screenshot_path).resolve()` starts with the configured screenshots directory. If not, return 403.
- **Verify:** `python3 -m py_compile` passes. Path resolution check exists.
- **Status:** pending

## T20 — Fix `models.py` path traversal (S-28)
- **File:** `/workspace/sa_helper/backend/app/api/admin_routes/models.py`
- **Change:** In model deletion endpoint, validate that the file path to delete is within the configured models directory using `Path.resolve()` check.
- **Verify:** `python3 -m py_compile` passes. Path validation exists.
- **Status:** pending

---

# PHASE 3: Low-Risk Extension Fixes (6 tasks) — ~2 hours

## T21 — Fix `lastRedirectAt` Map memory leak (E-011)
- **File:** `/workspace/sa_helper/extension/background.js`
- **Change:** Add a `chrome.tabs.onRemoved.addListener((tabId) => { lastRedirectAt.delete(tabId); })` to clean up the Map when tabs close. This prevents unbounded growth.
- **Verify:** `grep "tabs.onRemoved" /workspace/sa_helper/extension/background.js` returns match
- **Status:** pending

## T22 — Fix `background.js` default API_BASE (E-014)
- **File:** `/workspace/sa_helper/extension/background.js`
- **Change:** Change `const API_BASE = 'http://localhost:8780'` to `const API_BASE = 'http://localhost:8080'` (matches the actual backend port). Also add a comment recommending HTTPS for production.
- **Verify:** `grep "localhost:8780" /workspace/sa_helper/extension/background.js` returns NO matches
- **Status:** pending

## T23 — Fix service worker state restoration race (E-013)
- **File:** `/workspace/sa_helper/extension/background.js`
- **Change:** Add a `_ready` promise that resolves after `_automationState` is loaded from storage. All message handlers that reference `automationState` should `await _ready` first.
- **Verify:** `grep "_ready" /workspace/sa_helper/extension/background.js` returns matches
- **Status:** pending

## T24 — Fix `exam.js` setInterval handle (E-012)
- **File:** `/workspace/sa_helper/extension/modules/exam.js`
- **Change:** Store the `setInterval` return value (line ~436) in a module-level variable. Clear it when the exam module is deactivated or the tab navigates away.
- **Verify:** `grep "clearInterval" /workspace/sa_helper/extension/modules/exam.js` returns match
- **Status:** pending

## T25 — Fix `captcha.js` setInterval handle (E-012)
- **File:** `/workspace/sa_helper/extension/modules/captcha.js`
- **Change:** Store the `setInterval` return value (line ~228) in a module-level variable. Clear it when captcha solving is complete or deactivated.
- **Verify:** `grep "clearInterval" /workspace/sa_helper/extension/modules/captcha.js` returns match
- **Status:** pending

## T26 — Fix `sarathi_harden.js` setInterval handles (E-012)
- **File:** `/workspace/sa_helper/extension/modules/sarathi_harden.js`
- **Change:** Store both `setInterval` return values (lines ~79, ~175) in variables. Clear them when the module deactivates.
- **Verify:** `grep "clearInterval" /workspace/sa_helper/extension/modules/sarathi_harden.js` returns match
- **Status:** pending

---

# PHASE 4: Medium-Risk Fixes (7 tasks) — ~4 hours

## T27 — Fix `exam_service.py` ThreadPoolExecutor reuse (B-020)
- **File:** `/workspace/sa_helper/backend/app/services/exam_service.py`
- **Change:** Create a single module-level `_THREAD_POOL = ThreadPoolExecutor(max_workers=5)` instead of creating a new one per request. This avoids thread creation/destruction overhead.
- **Verify:** `python3 -m py_compile` passes. `ThreadPoolExecutor` is created once, not per request.
- **Status:** pending

## T28 — Fix `backup_service.py` atomic backup (B-005/S-20)
- **File:** `/workspace/sa_helper/backend/app/services/backup_service.py`
- **Change:** Replace `shutil.copy2(db_path, backup_path)` with `sqlite3.backup()` API:
  ```python
  src = sqlite3.connect(db_path)
  dst = sqlite3.connect(backup_path)
  src.backup(dst)
  dst.close()
  src.close()
  ```
  This produces atomic, consistent backups even while the DB is being written.
- **Verify:** `python3 -m py_compile` passes. `shutil.copy2` no longer used for DB copy.
- **Status:** pending

## T29 — Fix `backup_service.py` restore safety (B-006/S-21)
- **File:** `/workspace/sa_helper/backend/app/services/backup_service.py`
- **Change:** Add a check at the start of `restore_from_backup`: if the app is running (check for active DB connections), return an error telling the admin to stop the server first. Add a `--force` flag that skips the check.
- **Verify:** `python3 -m py_compile` passes. Running-app check exists.
- **Status:** pending

## T30 — Fix `onnx_model.py` CTC layout heuristic (B-008)
- **File:** `/workspace/sa_helper/backend/app/ai/onnx_model.py`
- **Change:** Replace `if raw.shape[1] == 1` with explicit shape check: `if raw.shape[0] == 1 and raw.shape[1] == 1` for the [B=1, T=63, C=63] case, and `if raw.shape[0] == 63 and raw.shape[1] == 1` for the [T=1, B=1, C=63] case. If ambiguous, log a warning and use the model's expected input shape from config.
- **Verify:** `python3 -m py_compile` passes. Shape check is explicit, not ambiguous.
- **Status:** pending

## T31 — Fix `telegram_bot.py` in-memory state (B-029)
- **File:** `/workspace/sa_helper/backend/app/services/telegram_bot.py`
- **Change:** Persist `_user_states` to `platform_settings` table (or a simple JSON file) on every state change. Restore on bot startup. Add a 30-minute timeout that auto-clears stale states.
- **Verify:** `python3 -m py_compile` passes. State persistence exists.
- **Status:** pending

## T32 — Fix `models.py` field_name silently ignored (B-031)
- **File:** `/workspace/sa_helper/backend/app/api/admin_routes/models.py`
- **Change:** If `field_name` is provided in the form, use it instead of `_default_field_for_task()`. Add a comment explaining the precedence.
- **Verify:** `python3 -m py_compile` passes. `field_name` from form is used when provided.
- **Status:** pending

## T33 — Fix `config.yaml` relative paths (B-022/S-25)
- **File:** `/workspace/sa_helper/backend/config/config.yaml`
- **Change:** Add a comment at the top explaining that all paths are relative to the backend directory. Alternatively, add a `base_dir` key and resolve all paths relative to it. Document in README that the server must be started from the `backend/` directory.
- **Verify:** `python3 -m py_compile` passes. Path documentation added.
- **Status:** pending

---

# EXECUTION ORDER

1. **Phase 1 (T1-T8)** — Trivial fixes, zero risk, ~1 hour
2. **Phase 2 (T9-T20)** — Low-risk backend fixes, ~3 hours
3. **Phase 3 (T21-T26)** — Low-risk extension fixes, ~2 hours
4. **Phase 4 (T27-T33)** — Medium-risk fixes, ~4 hours

After each phase, run verification commands:
- Backend: `python3 -m compileall -q /workspace/sa_helper/backend/`
- Frontend: `cd /workspace/sa_helper/frontend && npm run build`

---

# FINAL VERIFICATION

After ALL tasks complete:
1. Run `python3 -m compileall -q /workspace/sa_helper/backend/`
2. Run `cd /workspace/sa_helper/frontend && npm run build`
3. Report any errors found

---

# SUMMARY

| Phase | Tasks | Risk | Est. Time |
|-------|-------|------|-----------|
| Phase 1: Trivial | 8 | Zero | ~1 hour |
| Phase 2: Backend Low-Risk | 12 | Low | ~3 hours |
| Phase 3: Extension Low-Risk | 6 | Low | ~2 hours |
| Phase 4: Medium-Risk | 7 | Medium | ~4 hours |
| **Total** | **33** | | **~10 hours** |

**Items intentionally deferred: 20+ (postMessage, new Function, all_urls, vcam merge, browsingData, DB migration, TypeScript, VM integration, Dockerfile merge, etc.)**

**Items already fixed (from first sprint): 28**
**Items not actually broken (false positives): 2 (rate_limiter, start_backup.sh)**
**Total addressed across both sprints: 28 + 33 = 61 of ~115 distinct issues (53%)**