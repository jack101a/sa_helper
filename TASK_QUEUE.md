# TASK_QUEUE.md — Safe Bug Fix Sprint

## For Agent: deepseek-v4-flash
## Mode: BUILD (read + edit files, run verify commands)
## Rule: ONLY implement items listed here. NEVER touch items in the DEFERRED section.

---

## HOW TO WORK
1. Read this file and TASK.md
2. Pick the first pending task
3. Update TASK.md with that task's details
4. Read the target file(s) before editing
5. Make minimal surgical edits
6. Verify the change (run the verify command listed)
7. Update STATE.md
8. Mark task complete in this file
9. Repeat until all tasks are done

---

## ⛔ DEFERRED — DO NOT TOUCH THESE FILES OR FIXES

These items are SKIPPED intentionally. Both review agents agree they would break things:

- **DO NOT change `postMessage('*')`** in any extension file (touches 10+ files, could break cross-frame communication)
- **DO NOT encrypt API keys** in chrome.storage.local (needs coordinated update of popup, options, background.js)
- **DO NOT scope dialog/fetch/XHR overrides** to target domain (captcha images may come from CDN)
- **DO NOT add sender origin validation** to message handlers (could block legitimate messages)
- **DO NOT migrate legacy DB to SQLAlchemy** (separate 2-4 week project)
- **DO NOT add TypeScript** to frontend (separate 2-4 week project)
- **DO NOT implement Violentmonkey integration** (separate 3-4 week project)
- **DO NOT rewrite Alembic migrations** (current `Base.metadata.create_all()` workaround works)
- **DO NOT constrain `<all_urls>` scope** (would break userscript engine)
- **DO NOT fix weak session cookie** (would invalidate all admin sessions)
- **DO NOT run `git filter-branch` or `git rm --cached`** on secrets (coordinated rotation needed)

---

# PHASE 1: Git Hygiene & Secrets (5 tasks)

## G1 — Add `extension.pem` to `.gitignore`
- **File:** `/workspace/sa_helper/.gitignore`
- **Change:** Add line `extension.pem` under the "Project Specific" section
- **Verify:** `grep "extension.pem" /workspace/sa_helper/.gitignore` returns a match
- **Status:** completed

## G2 — Add `config/backend.env` to `.gitignore`
- **File:** `/workspace/sa_helper/.gitignore`
- **Change:** Add line `config/backend.env` under the "Project Specific" section
- **Verify:** `grep "config/backend.env" /workspace/sa_helper/.gitignore` returns a match
- **Status:** completed

## G3 — Add `extension.pem` to `.dockerignore`
- **File:** `/workspace/sa_helper/.dockerignore`
- **Change:** Add line `extension.pem` (so private key never enters Docker image)
- **Verify:** `grep "extension.pem" /workspace/sa_helper/.dockerignore` returns a match
- **Status:** completed

## G4 — Replace insecure defaults in `docker-compose.yml`
- **File:** `/workspace/sa_helper/docker-compose.yml`
- **Change:** Replace hardcoded credentials on lines 15-18:
  - `AUTH_HASH_SALT:-test12345678` → `AUTH_HASH_SALT:-}` (empty default, forces user to set)
  - `ADMIN_TOKEN:-admin123` → `ADMIN_TOKEN:-}`
  - `ADMIN_PASSWORD:-123456` → `ADMIN_PASSWORD:-}`
- **Verify:** `grep -E "test12345678|admin123" /workspace/sa_helper/docker-compose.yml` returns NO matches
- **Status:** completed

## G5 — Remove hardcoded credentials from `config/backend.env`
- **File:** `/workspace/sa_helper/config/backend.env`
- **Change:** Replace lines 3 and 5:
  - `ADMIN_TOKEN=123456` → `ADMIN_TOKEN=change_me_strong_random_token`
  - `ADMIN_PASSWORD=123456` → `ADMIN_PASSWORD=change_me_strong_password`
- **Verify:** `grep -E "^ADMIN_TOKEN=123456|^ADMIN_PASSWORD=123456" /workspace/sa_helper/config/backend.env` returns NO matches
- **Status:** completed

---

# PHASE 2: Backend Bug Fixes (10 tasks)

## B1 — Fix `system.py` restart (CRITICAL)
- **File:** `/workspace/sa_helper/backend/app/api/admin_routes/system.py`
- **Fix:** Replaced `os.system("pkill -9 ...") + time.sleep(2) + subprocess.Popen` with a single `subprocess.Popen(["bash", "-c", "sleep 2; pkill...; pkill...; exec bash <script>"], start_new_session=True)` — response is returned immediately, then the child kills old procs and starts new ones after 2s delay.
- **Verify:** `python3 -m py_compile` passes. No `os.system` call in restart endpoint.
- **Status:** completed

## B2 — Fix `payments.py` asyncio.run() (CRITICAL)
- **File:** `/workspace/sa_helper/backend/app/api/admin_routes/payments.py`
- **Fix:** Changed `_try_notify_user` from sync → async, replaced `asyncio.run(bot.send_message(...))` with `await bot.send_message(...)`, added `await` to both callers.
- **Verify:** `grep "asyncio.run"` returns no matches. `python3 -m py_compile` passes.
- **Status:** completed

## B3 — Fix `routes.py` key create/revoke auth (CRITICAL)
- **File:** `/workspace/sa_helper/backend/app/api/routes.py`
- **Fix:** Added `_ensure_master_key(request)` to both `create_key` and `revoke_key` handlers. The guard function already existed (used by `propose_locator`).
- **Verify:** `python3 -m py_compile` passes. Both handlers now call `_ensure_master_key(request)` first.
- **Status:** completed

## B4 — Fix `settings.py` QR image auth (HIGH)
- **File:** `/workspace/sa_helper/backend/app/api/admin_routes/settings.py`
- **Fix:** Added `request: Request` parameter and `_admin_guard(request)` check to `get_qr_image` handler.
- **Verify:** `python3 -m py_compile` passes. QR endpoint now requires admin auth.
- **Status:** completed

## B5 — Fix `auth.py` login logging (HIGH)
- **File:** `/workspace/sa_helper/backend/app/api/admin_routes/auth.py`
- **Fix:** Removed `submitted_username`, `submitted_password_len`, `expected_username`, `expected_password_len` from login log. Only `has_user_pass` remains.
- **Verify:** `python3 -m py_compile` passes. No credential info in logger calls.
- **Status:** completed

## B6 — Fix `payments.py` JSON injection (HIGH)
- **File:** `/workspace/sa_helper/backend/app/api/admin_routes/payments.py`
- **Fix:** Replaced `f'{{"reason": "{reason}"}}'` with `json.dumps({"reason": reason})`. Added `import json`.
- **Verify:** `python3 -m py_compile` passes. No f-string JSON construction.
- **Status:** completed

## B7 — Fix `subscriptions.py` KeyError crash (MEDIUM)
- **File:** `/workspace/sa_helper/backend/app/api/admin_routes/subscriptions.py`
- **Fix:** Changed `body["code"]` to `body.get("code")`.
- **Verify:** `python3 -m py_compile` passes. No `body["code"]` in file.
- **Status:** completed

## B8 — Fix `models.py` orphaned .onnx file (MEDIUM)
- **File:** `/workspace/sa_helper/backend/app/api/admin_routes/models.py`
- **Fix:** Added `target.unlink(missing_ok=True)` cleanup in both `sqlite3.IntegrityError` and general `Exception` handlers after DB insert failure.
- **Verify:** `python3 -m py_compile` passes. File cleaned up on DB failure.
- **Status:** completed

## B9 — Fix `autofill.py` silent failure (MEDIUM)
- **File:** `/workspace/sa_helper/backend/app/api/admin_routes/autofill.py`
- **Fix:** Replaced `except Exception: pass` with `except Exception as e: failed.append(...)`. Response now returns `approved`, `failed`, `errors` instead of misleading `count`.
- **Verify:** `python3 -m py_compile` passes. No bare `except Exception: pass` in file.
- **Status:** completed

## B10 — Add missing async DB driver (CRITICAL)
- **File:** `/workspace/sa_helper/backend/requirements.txt`
- **Fix:** Added `aiosqlite>=0.18.0` to requirements.txt.
- **Verify:** `grep "aiosqlite" /workspace/sa_helper/backend/requirements.txt` returns match.
- **Status:** completed

---

# PHASE 3: Frontend Bug Fixes (6 tasks)

## F1 — Fix `App.jsx` dashboardPage remount (CRITICAL)
- **File:** `/workspace/sa_helper/frontend/src/app/App.jsx`
- **Fix:** Extracted `DashboardPage` as a module-level component (above `App`). Route now uses `<DashboardPage ...props />` instead of inline JSX. Removed stale `dashboardPage`, `statCards`, `latencyValue` from `App`.
- **Verify:** DashboardPage defined before App, no `const dashboardPage` in render, route uses `<DashboardPage`.
- **Status:** completed

## F2 — Fix `useKeyHandlers.js` reset crash (CRITICAL)
- **File:** `/workspace/sa_helper/frontend/src/app/hooks/useKeyHandlers.js`
- **Fix:** Removed `{ e }` destructuring and `e.target.reset()` from `onSuccess`. Moved `form.reset()` to `handleCreateKey` before `mutate`. Removed `{ e }` from `mutate` call.
- **Verify:** No `e.target.reset()` in file. Form reset happens before mutation.
- **Status:** completed

## F3 — Fix `useSettingsHandlers.js` JSON.parse crash (HIGH)
- **File:** `/workspace/sa_helper/frontend/src/app/hooks/useSettingsHandlers.js`
- **Bug:** Lines ~170, ~186: `JSON.parse(text)` called without try/catch.
- **Status:** **ALREADY FIXED** — Both `JSON.parse(text)` calls (lines 172, 188) are already inside `try/catch` blocks. No change needed.
- **Status:** completed

## F4 — Fix `KeysPanel.jsx` clipboard crash (HIGH)
- **File:** `/workspace/sa_helper/frontend/src/app/components/KeysPanel.jsx`
- **Fix:** Added `.catch(() => {})` to `navigator.clipboard.writeText` call on master key copy button.
- **Verify:** `navigator.clipboard.writeText` now has `.catch()` handler.
- **Status:** completed

## F5 — Fix `Sidebar.jsx` invalid Tailwind classes (HIGH)
- **File:** `/workspace/sa_helper/frontend/src/app/components/Sidebar.jsx`
- **Fix:** Replaced template literal Tailwind dynamic class `` hover:${isDark ? "bg-white/5" : "bg-black/5"} `` with pre-computed `inactiveHover` variable. Also fixed `activeBg` with same pattern.
- **Verify:** No `hover:${isDark ?` template in className. Tailwind can detect full class strings.
- **Status:** completed

## F6 — Fix `useToast.js` timeout leak (HIGH)
- **File:** `/workspace/sa_helper/frontend/src/app/hooks/useToast.js`
- **Fix:** Added `useRef` for timeout ID. `clearTimeout` called before each new `setTimeout`. Timeout ref cleared after firing.
- **Verify:** No stale timeouts — clearTimeout before every setTimeout.
- **Status:** completed

---

# PHASE 4: Infrastructure & CI/CD Fixes (7 tasks)

## I1 — Fix `publish-api.yml` Dockerfile path
- **File:** `/workspace/sa_helper/.github/workflows/publish-api.yml`
- **Fix:** Changed `context: platform` → `context: .` and `file: platform/backend/docker/Dockerfile` → `file: ./Dockerfile`. These are complementary workflows: docker.yml (before-scale), publish-api.yml (main/test/claude/refactor).
- **Verify:** No `platform/` references remain in file.
- **Status:** completed

## I2 — Fix `publish-ui.yml` Dockerfile path
- **File:** `/workspace/sa_helper/.github/workflows/publish-ui.yml`
- **Fix:** Changed `context: platform/backend/admin-ui` → `context: ./frontend` and `file: platform/backend/admin-ui/Dockerfile` → `file: ./frontend/Dockerfile`. Frontend Dockerfile exists and references existing nginx.conf.
- **Verify:** No `platform/` references remain in file.
- **Status:** completed

## I3 — Fix `start_backend.sh` port mismatch
- **File:** `/workspace/sa_helper/scripts/start_backend.sh`
- **Fix:** Changed `--port 8780` → `--port 8080` and echo message updated accordingly.
- **Verify:** `grep "8780" /workspace/sa_helper/scripts/start_backend.sh` returns no matches.
- **Status:** completed

## I4 — Fix `stop_backend.sh` Telegram bot orphan
- **File:** `/workspace/sa_helper/scripts/stop_backend.sh`
- **Fix:** Added `pkill -f "app.services.telegram_bot"` line after uvicorn kill.
- **Verify:** stop_backend.sh now kills both processes.
- **Status:** completed

## I5 — Fix `stop.bat` kills all Python
- **File:** `/workspace/sa_helper/scripts/stop.bat`
- **Fix:** Replaced `taskkill /F /IM python.exe /T` with `wmic` command that targets only python.exe processes whose command line contains 'uvicorn' or 'telegram_bot'.
- **Verify:** No `taskkill /IM python.exe` in file.
- **Status:** completed

## I6 — Fix `deploy.sh` missing nginx.conf
- **File:** `/workspace/sa_helper/infra/systemd/deploy.sh` + `/workspace/sa_helper/nginx.conf`
- **Fix:** Created `/workspace/sa_helper/nginx.conf` — a basic reverse-proxy config for the backend on port 8080. deploy.sh can now find it during the `cp -r . $APP_DIR/` copy step.
- **Verify:** `/workspace/sa_helper/nginx.conf` exists.
- **Status:** completed

## I7 — Fix `cache_service.py` thread safety (CRITICAL)
- **File:** `/workspace/sa_helper/backend/app/services/cache_service.py`
- **Fix:** Added `self._lock = threading.Lock()`. Wrapped all `self._store` accesses in `get()`, `set()`, `cleanup()` with `with self._lock:`.
- **Verify:** `python3 -m py_compile` passes. Every `self._store` access is inside lock.
- **Status:** completed

---

# EXECUTION ORDER
1. Phase 1 (G1-G5) — zero code risk, git hygiene
2. Phase 2 (B1-B10) — backend fixes
3. Phase 3 (F1-F6) — frontend fixes
4. Phase 4 (I1-I7) — infra & CI/CD

After each phase, run verification commands:
- Backend: `python -m compileall backend/` (from /workspace/sa_helper/)
- Frontend: `cd frontend && npm run build` (if npm is available)

---

# FINAL VERIFICATION
After ALL tasks complete:
1. Run `python -m compileall backend/` in /workspace/sa_helper/
2. Run `cd frontend && npm run build` in /workspace/sa_helper/ (if npm available)
3. Report any errors found