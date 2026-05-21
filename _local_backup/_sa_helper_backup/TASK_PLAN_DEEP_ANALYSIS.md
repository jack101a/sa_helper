# DEEP CODEBASE ANALYSIS & VIOLENTMONKEY INTEGRATION PLAN

## AGENT: deepseek-v4-flash
## ROLE: Full-stack deep analyzer & integration architect
## STATUS: READY TO EXECUTE

---

# ═══════════════════════════════════════════════════════════════
# PHASE 0: ENVIRONMENT SETUP & CONTEXT LOADING
# ═══════════════════════════════════════════════════════════════

## STEP 0.1 — Navigate to workspace
```
cd /workspace/sa_helper
```

## STEP 0.2 — Read ALL agent context files (mandatory before any work)
Read these files in order:
1. `/workspace/sa_helper/AGENTS.md` — AI agent operating directives (182 lines, defines continuous execution loop)
2. `/workspace/sa_helper/STATE.md` — Last active task state (currently COMPLETE)
3. `/workspace/sa_helper/TASK.md` — Current task description
4. `/workspace/sa_helper/TASK_QUEUE.md` — Bug fix sprint task queue (B1-B6, all completed)

## STEP 0.3 — Verify git state
```bash
git status
git log --oneline -10
```

---

# ═══════════════════════════════════════════════════════════════
# PHASE 1: BACKEND DEEP ANALYSIS
# ═══════════════════════════════════════════════════════════════

## 1.1 — Read every Python file for bugs, syntax errors, and issues

### FILES TO READ (in order):

#### Core layer:
1. `/workspace/sa_helper/backend/app/main.py` — FastAPI entrypoint
2. `/workspace/sa_helper/backend/app/core/config.py` — Settings loader (YAML + .env)
3. `/workspace/sa_helper/backend/app/core/container.py` — DI container
4. `/workspace/sa_helper/backend/app/core/database.py` — Legacy raw-SQLite facade
5. `/workspace/sa_helper/backend/app/core/db.py` — SQLAlchemy engine/session
6. `/workspace/sa_helper/backend/app/core/models.py` — SQLAlchemy ORM models
7. `/workspace/sa_helper/backend/app/core/security.py` — Key generation/hashing
8. `/workspace/sa_helper/backend/app/core/logging.py` — Structured JSON logging
9. `/workspace/sa_helper/backend/app/core/paths.py` — Project root resolution
10. `/workspace/sa_helper/backend/app/core/userscript_utils.py` — Userscript parser

#### Repositories:
11. `/workspace/sa_helper/backend/app/core/repositories/base.py`
12. `/workspace/sa_helper/backend/app/core/repositories/api_keys.py`
13. `/workspace/sa_helper/backend/app/core/repositories/models.py`
14. `/workspace/sa_helper/backend/app/core/repositories/autofill.py`
15. `/workspace/sa_helper/backend/app/core/repositories/exam.py`
16. `/workspace/sa_helper/backend/app/core/repositories/exam_attempts.py`
17. `/workspace/sa_helper/backend/app/core/repositories/exam_learned.py`
18. `/workspace/sa_helper/backend/app/core/repositories/training.py`
19. `/workspace/sa_helper/backend/app/core/repositories/settings.py`

#### API Routes:
20. `/workspace/sa_helper/backend/app/api/routes.py` — Public v1 API
21. `/workspace/sa_helper/backend/app/api/admin.py` — Admin router
22. `/workspace/sa_helper/backend/app/api/admin_routes/__init__.py`
23. `/workspace/sa_helper/backend/app/api/admin_routes/utils.py`
24. `/workspace/sa_helper/backend/app/api/admin_routes/auth.py`
25. `/workspace/sa_helper/backend/app/api/admin_routes/keys.py`
26. `/workspace/sa_helper/backend/app/api/admin_routes/models.py`
27. `/workspace/sa_helper/backend/app/api/admin_routes/datasets.py`
28. `/workspace/sa_helper/backend/app/api/admin_routes/backups.py`
29. `/workspace/sa_helper/backend/app/api/admin_routes/autofill.py`
30. `/workspace/sa_helper/backend/app/api/admin_routes/locators.py`
31. `/workspace/sa_helper/backend/app/api/admin_routes/settings.py`
32. `/workspace/sa_helper/backend/app/api/admin_routes/analytics.py`
33. `/workspace/sa_helper/backend/app/api/admin_routes/captcha_proposals.py`
34. `/workspace/sa_helper/backend/app/api/admin_routes/users.py`
35. `/workspace/sa_helper/backend/app/api/admin_routes/payments.py`
36. `/workspace/sa_helper/backend/app/api/admin_routes/subscriptions.py`
37. `/workspace/sa_helper/backend/app/api/admin_routes/user_keys.py`
38. `/workspace/sa_helper/backend/app/api/admin_routes/system.py`

#### Middleware:
39. `/workspace/sa_helper/backend/app/middleware/auth_middleware.py`
40. `/workspace/sa_helper/backend/app/middleware/rate_limit_middleware.py`
41. `/workspace/sa_helper/backend/app/middleware/logging_middleware.py`

#### Services:
42. `/workspace/sa_helper/backend/app/services/solver_service.py`
43. `/workspace/sa_helper/backend/app/services/exam_service.py`
44. `/workspace/sa_helper/backend/app/services/autofill_service.py`
45. `/workspace/sa_helper/backend/app/services/key_service.py`
46. `/workspace/sa_helper/backend/app/services/user_key_service.py`
47. `/workspace/sa_helper/backend/app/services/user_service.py`
48. `/workspace/sa_helper/backend/app/services/subscription_service.py`
49. `/workspace/sa_helper/backend/app/services/payment_service.py`
50. `/workspace/sa_helper/backend/app/services/usage_service.py`
51. `/workspace/sa_helper/backend/app/services/usage_cycle_service.py`
52. `/workspace/sa_helper/backend/app/services/rate_limiter.py`
53. `/workspace/sa_helper/backend/app/services/cache_service.py`
54. `/workspace/sa_helper/backend/app/services/model_router.py`
55. `/workspace/sa_helper/backend/app/services/alert_service.py`
56. `/workspace/sa_helper/backend/app/services/audit_service.py`
57. `/workspace/sa_helper/backend/app/services/backup_service.py`
58. `/workspace/sa_helper/backend/app/services/extension_service.py`
59. `/workspace/sa_helper/backend/app/services/telegram_bot.py`

#### Models & AI:
60. `/workspace/sa_helper/backend/app/models/schemas.py` — Pydantic models
61. `/workspace/sa_helper/backend/app/ai/base_model.py`
62. `/workspace/sa_helper/backend/app/ai/onnx_model.py`

#### Config:
63. `/workspace/sa_helper/backend/requirements.txt`
64. `/workspace/sa_helper/backend/config/config.yaml`
65. `/workspace/sa_helper/backend/alembic.ini`

#### Migrations:
66. `/workspace/sa_helper/backend/migrations/env.py`
67. `/workspace/sa_helper/backend/migrations/versions/94bfa105be00_initial_schema.py`
68. `/workspace/sa_helper/backend/migrations/versions/b2c3d4e5f678_add_payment_and_key_tracking_fields.py`

#### Tests:
69. `/workspace/sa_helper/backend/tests/test_services.py`
70. `/workspace/sa_helper/backend/tests/test_extension_download.py`

## 1.2 — CHECKLIST for each backend file:
For EVERY file read, analyze and report:

### SYNTAX & LOGIC BUGS:
- [ ] Missing imports
- [ ] Undefined variables
- [ ] Incorrect type annotations
- [ ] Logic errors (wrong conditions, inverted booleans)
- [ ] Off-by-one errors
- [ ] Unreachable code
- [ ] Infinite loop risks
- [ ] Race conditions (async/await misuse)
- [ ] Missing error handling (bare excepts, no try/catch where needed)

### SECURITY ISSUES:
- [ ] SQL injection vulnerabilities (string formatting in queries)
- [ ] API key exposure in logs/errors
- [ ] Missing authentication checks on admin routes
- [ ] Insecure direct object references (IDOR)
- [ ] Path traversal risks (file paths from user input)
- [ ] Hardcoded secrets/credentials
- [ ] Weak crypto (MD5, SHA1 for passwords)
- [ ] CORS misconfiguration
- [ ] Rate limiting bypass vectors

### WORKFLOW BUGS:
- [ ] Missing validation on user input
- [ ] Incorrect HTTP status codes
- [ ] Inconsistent error response format
- [ ] Database transaction handling (missing rollback)
- [ ] Orphaned resources (files not cleaned up)
- [ ] Circular dependencies
- [ ] Incorrect dependency injection wiring

### PERFORMANCE:
- [ ] N+1 query patterns
- [ ] Missing database indexes
- [ ] Blocking I/O in async context
- [ ] Memory leaks (growing caches, unclosed files)
- [ ] Unbounded query results (no LIMIT)

### SPECIFIC PATTERNS TO CHECK:
- [ ] Are both legacy SQLite AND new SQLAlchemy paths tested?
- [ ] Does admin auth check actually block unauthorized access?
- [ ] Are rate limits properly enforced or bypassable?
- [ ] Is the `/v1/locators` endpoint truly public (no auth)?
- [ ] Does the system restart endpoint have proper safeguards?
- [ ] Are file uploads validated for size/type/path traversal?
- [ ] Does the backup service handle concurrent operations safely?

---

# ═══════════════════════════════════════════════════════════════
# PHASE 2: FRONTEND DEEP ANALYSIS
# ═══════════════════════════════════════════════════════════════

## 2.1 — Read every frontend file for bugs and issues

### FILES TO READ (in order):

1. `/workspace/sa_helper/frontend/package.json`
2. `/workspace/sa_helper/frontend/vite.config.js`
3. `/workspace/sa_helper/frontend/index.html`
4. `/workspace/sa_helper/frontend/nginx.conf`
5. `/workspace/sa_helper/frontend/Dockerfile`
6. `/workspace/sa_helper/frontend/src/main.jsx`
7. `/workspace/sa_helper/frontend/src/styles/globals.css`
8. `/workspace/sa_helper/frontend/src/api/client.js`
9. `/workspace/sa_helper/frontend/src/api/queries.js`
10. `/workspace/sa_helper/frontend/src/app/App.jsx`
11. `/workspace/sa_helper/frontend/src/app/context/ThemeContext.jsx`
12. `/workspace/sa_helper/frontend/src/app/hooks/useAdminData.js`
13. `/workspace/sa_helper/frontend/src/app/hooks/useAuth.js`
14. `/workspace/sa_helper/frontend/src/app/hooks/useToast.js`
15. `/workspace/sa_helper/frontend/src/app/hooks/useDebounce.js`
16. `/workspace/sa_helper/frontend/src/app/hooks/useKeyboardShortcuts.js`
17. `/workspace/sa_helper/frontend/src/app/hooks/useTheme.js`
18. `/workspace/sa_helper/frontend/src/app/hooks/useKeyHandlers.js`
19. `/workspace/sa_helper/frontend/src/app/hooks/useModelHandlers.js`
20. `/workspace/sa_helper/frontend/src/app/hooks/useProposalHandlers.js`
21. `/workspace/sa_helper/frontend/src/app/hooks/useSettingsHandlers.js`
22. `/workspace/sa_helper/frontend/src/app/layout/DashboardLayout.jsx`
23. `/workspace/sa_helper/frontend/src/app/components/Sidebar.jsx`
24. `/workspace/sa_helper/frontend/src/app/components/ErrorBoundary.jsx`
25. `/workspace/sa_helper/frontend/src/app/components/Skeleton.jsx`
26. `/workspace/sa_helper/frontend/src/app/components/EmptyState.jsx`
27. `/workspace/sa_helper/frontend/src/app/components/DashboardPanel.jsx`
28. `/workspace/sa_helper/frontend/src/app/components/KeysPanel.jsx`
29. `/workspace/sa_helper/frontend/src/app/components/SubscriptionsPanel.jsx`
30. `/workspace/sa_helper/frontend/src/app/components/UsersPanel.jsx`
31. `/workspace/sa_helper/frontend/src/app/components/PaymentsPanel.jsx`
32. `/workspace/sa_helper/frontend/src/app/components/PlansPanel.jsx`
33. `/workspace/sa_helper/frontend/src/app/components/UserscriptsPanel.jsx`
34. `/workspace/sa_helper/frontend/src/app/components/ModelsPanel.jsx`
35. `/workspace/sa_helper/frontend/src/app/components/MappingsPanel.jsx`
36. `/workspace/sa_helper/frontend/src/app/components/ExamStatsPanel.jsx`
37. `/workspace/sa_helper/frontend/src/app/components/SettingsPanel.jsx`
38. `/workspace/sa_helper/frontend/src/app/components/AutofillProposalsPanel.jsx`
39. `/workspace/sa_helper/frontend/src/app/components/CaptchaProposalsPanel.jsx`

## 2.2 — CHECKLIST for each frontend file:
For EVERY file read, analyze and report:

### SYNTAX & RUNTIME BUGS:
- [ ] Missing imports
- [ ] Undefined variables/functions
- [ ] Incorrect prop types
- [ ] State update on unmounted component
- [ ] Missing keys in lists
- [ ] Incorrect hook dependency arrays
- [ ] Infinite re-render loops
- [ ] setState called during render
- [ ] useEffect cleanup missing

### UI/UX ISSUES:
- [ ] Broken responsive layout at mobile breakpoints
- [ ] Accessibility issues (missing aria labels, no keyboard nav)
- [ ] Color contrast problems (especially dark/light theme)
- [ ] Loading states missing or broken
- [ ] Error states not handled gracefully
- [ ] Empty states not shown
- [ ] Confusing UX flows
- [ ] Missing form validation
- [ ] Unclear button labels/actions
- [ ] Animation performance issues

### SECURITY:
- [ ] XSS vulnerabilities (dangerouslySetInnerHTML, unescaped user content)
- [ ] CSRF token handling
- [ ] Sensitive data in localStorage
- [ ] API keys exposed in DOM
- [ ] Open redirect vulnerabilities
- [ ] Content injection via user input fields

### PERFORMANCE:
- [ ] Unnecessary re-renders (missing React.memo, useMemo, useCallback)
- [ ] Large bundle size (check imports)
- [ ] No code splitting (check lazy loading)
- [ ] Memory leaks (event listeners not cleaned up)
- [ ] Heavy computations in render

### WORKFLOW BUGS:
- [ ] Stale data after mutations (missing query invalidation)
- [ ] Optimistic update rollback failures
- [ ] Race conditions in async operations
- [ ] Form submission double-click issues
- [ ] Navigation state not preserved
- [ ] Browser back button broken

---

# ═══════════════════════════════════════════════════════════════
# PHASE 3: EXTENSION DEEP ANALYSIS (MOST CRITICAL)
# ═══════════════════════════════════════════════════════════════

## 3.1 — Read EVERY extension file in order

### Manifest & Build:
1. `/workspace/sa_helper/extension/manifest.json`
2. `/workspace/sa_helper/extension/manifest_firefox.json`
3. `/workspace/sa_helper/extension/rules.json`
4. `/workspace/sa_helper/extension/favicon.svg`

### Background Service Worker (1381 lines — READ FULLY):
5. `/workspace/sa_helper/extension/background.js`

### Content Scripts (READ ALL):
6. `/workspace/sa_helper/extension/content.js`
7. `/workspace/sa_helper/extension/locator_picker.js`
8. `/workspace/sa_helper/extension/modules/userscript_engine.js`
9. `/workspace/sa_helper/extension/modules/dialog_boot.js`
10. `/workspace/sa_helper/extension/modules/main_inject.js`
11. `/workspace/sa_helper/extension/modules/vcam_inject.js`
12. `/workspace/sa_helper/extension/modules/shared_utils.js`
13. `/workspace/sa_helper/extension/modules/sarathi_harden.js`
14. `/workspace/sa_helper/extension/modules/captcha.js`
15. `/workspace/sa_helper/extension/modules/exam.js`
16. `/workspace/sa_helper/extension/modules/autofill.js`
17. `/workspace/sa_helper/extension/modules/stall_automation.js`
18. `/workspace/sa_helper/extension/modules/vcam_controller.js`
19. `/workspace/sa_helper/extension/modules/dialog_handler.js`
20. `/workspace/sa_helper/extension/modules/human_utils.js`
21. `/workspace/sa_helper/extension/modules/sarathi_panel.js` (1409 lines — READ FULLY)

### Popup:
22. `/workspace/sa_helper/extension/popup/popup.html`
23. `/workspace/sa_helper/extension/popup/popup.js`
24. `/workspace/sa_helper/extension/popup/popup.css`

### Options:
25. `/workspace/sa_helper/extension/options/options.html`
26. `/workspace/sa_helper/extension/options/options.js`
27. `/workspace/sa_helper/extension/options/options.css`

### Dynamic Steps:
28. `/workspace/sa_helper/extension/dynamic_steps/step3.js`
29. `/workspace/sa_helper/extension/dynamic_steps/step4.js`

## 3.2 — EXTENSION-SPECIFIC CHECKLIST:

### MANIFEST ISSUES:
- [ ] Missing required permissions for features used
- [ ] Overly broad permissions (security review)
- [ ] Content script matches too broad/narrow
- [ ] Content script run_at timing issues
- [ ] Web accessible resources exposing sensitive files
- [ ] CSP restrictions too loose or too strict
- [ ] Missing minimum_chrome_version
- [ ] Firefox vs Chrome compatibility gaps

### BACKGROUND SERVICE WORKER:
- [ ] Service worker lifecycle bugs (wake/sleep)
- [ ] State lost on service worker restart
- [ ] Alarm timing issues
- [ ] Message handler race conditions
- [ ] API error handling gaps
- [ ] Sync conflicts (multiple sync sources)
- [ ] Storage quota issues
- [ ] Unhandled promise rejections

### CONTENT SCRIPT INJECTION:
- [ ] Double-injection prevention working?
- [ ] Timing issues (document_start vs document_idle)
- [ ] ISOLATED vs MAIN world conflicts
- [ ] iframe handling correct?
- [ ] Script removal on navigation

### MESSAGE PASSING:
- [ ] postMessage targetOrigin using '*' (security risk)
- [ ] Message type collisions
- [ ] Missing response handling
- [ ] Message size limits
- [ ] Orphaned listeners

### USERSCRIPT ENGINE:
- [ ] @match/@exclude pattern correctness
- [ ] @require/@resource fetch error handling
- [ ] @connect validation bypass vectors
- [ ] Script execution order (document-start/end/idle)
- [ ] GM API shim completeness
- [ ] Storage namespace isolation
- [ ] Script update/removal handling

### SECURITY (CRITICAL):
- [ ] API key in plaintext storage
- [ ] postMessage with '*' targetOrigin
- [ ] browsingData.remove called without user confirmation
- [ ] navigator.mediaDevices override scope
- [ ] document.hidden override for stall keepalive
- [ ] No input sanitization on script names
- [ ] fetch to http:// (not https://) by default
- [ ] Extension signing key (extension.pem) exposed in repo

### PERFORMANCE:
- [ ] Excessive polling intervals
- [ ] Memory leaks in MutationObserver
- [ ] Large images stored in chrome.storage.local
- [ ] Unnecessary sync calls
- [ ] DOM manipulation performance

### WORKFLOW:
- [ ] STALL automation state machine correctness
- [ ] Exam module abort logic (6 wrong → stop)
- [ ] Captcha retry logic
- [ ] Autofill rule conflict resolution
- [ ] VCAM state sync between ISOLATED and MAIN world

---

# ═══════════════════════════════════════════════════════════════
# PHASE 4: ROOT CONFIG & INFRASTRUCTURE ANALYSIS
# ═══════════════════════════════════════════════════════════════

## 4.1 — Read root config files

1. `/workspace/sa_helper/Dockerfile`
2. `/workspace/sa_helper/docker-compose.yml`
3. `/workspace/sa_helper/docker-entrypoint.sh`
4. `/workspace/sa_helper/.gitignore`
5. `/workspace/sa_helper/.dockerignore`
6. `/workspace/sa_helper/.gitattributes`
7. `/workspace/sa_helper/README.md`
8. `/workspace/sa_helper/rules_export.sql`
9. `/workspace/sa_helper/extension.pem` — CHECK IF PRIVATE KEY IS IN REPO

### Config directory:
10. `/workspace/sa_helper/config/.env` — IF EXISTS
11. `/workspace/sa_helper/config/.env.example`
12. `/workspace/sa_helper/config/backend.env`

### Scripts:
13. `/workspace/sa_helper/scripts/start_backend.sh`
14. `/workspace/sa_helper/scripts/stop_backend.sh`
15. `/workspace/sa_helper/scripts/start.bat`
16. `/workspace/sa_helper/scripts/stop.bat`
17. `/workspace/sa_helper/scripts/package_extension.ps1`

### Infrastructure:
18. `/workspace/sa_helper/infra/docker-compose.yml`
19. `/workspace/sa_helper/infra/backend/Dockerfile`
20. `/workspace/sa_helper/infra/systemd/unified-platform.service`
21. `/workspace/sa_helper/infra/systemd/deploy.sh`

### GitHub Actions:
22. `/workspace/sa_helper/.github/workflows/docker.yml`
23. `/workspace/sa_helper/.github/workflows/publish-api.yml`
24. `/workspace/sa_helper/.github/workflows/publish-ui.yml`

## 4.2 — INFRA CHECKLIST:

- [ ] Port mismatches (8780 vs 8080 vs 8088)
- [ ] Two different Dockerfiles — which is canonical?
- [ ] Two different docker-compose files — conflicts?
- [ ] GitHub Actions reference `platform/` directory that doesn't exist
- [ ] Secrets in `rules_export.sql` (LiteLLM key, Telegram token, master API key)
- [ ] `extension.pem` private key exposed in repo
- [ ] `config/backend.env` tracked in git (could leak secrets)
- [ ] Missing `.env` validation
- [ ] Tesseract language data availability
- [ ] ONNX model file availability
- [ ] Healthcheck correctness

---

# ═══════════════════════════════════════════════════════════════
# PHASE 5: VIOLENTMONKEY INTEGRATION ANALYSIS
# ═══════════════════════════════════════════════════════════════

## 5.1 — VIOLENTMONKEY BACKGROUND (what we know)

Violentmonkey is the most popular open-source userscript manager (8.2k stars, MIT license).
It's built with:
- **Vue 3** for UI (popup, options, confirm dialogs)
- **Webpack** build system (with Babel, TypeScript)
- **Manifest V2** currently (manifest.yml → converted)
- **CodeMirror 5** for script editor
- **zip.js** for backup/export

### Architecture:
```
src/
├── background/     — Background script (state management, sync, API)
├── common/         — Shared utilities (storage, i18n, messaging)
├── confirm/        — Vue-based confirmation dialog
├── injected/       — Content scripts injected into pages
│   ├── content/    — Script execution, values bridge
│   ├── util/       — DOM utilities
│   ├── web/        — Web-accessible script injection
│   ├── index.js    — Main injection orchestrator
│   └── safe-globals.js — Sandboxed globals
├── options/        — Vue SPA options page (script editor, settings)
├── popup/          — Vue popup (script list, toggles)
├── resources/      — Static assets
├── _locales/       — i18n translations
├── manifest.yml    — Manifest V2 definition
└── types.d.ts      — TypeScript type definitions
```

### Key Features vs Our Extension:
| Feature | Violentmonkey | Our Extension |
|---------|--------------|---------------|
| Script editor | CodeMirror 5 (full-featured) | Textarea in options |
| Script storage | IndexedDB (structured) | chrome.storage.local (flat) |
| Script sync | URL-based auto-update | Server-pushed sync |
| GM API | Full GM_* API support | Partial GM API shim |
| @require/@resource | Fetch & cache | Fetch & bundle inline |
| UI framework | Vue 3 SPA | Vanilla JS |
| Build system | Webpack + Babel + TS | No build (raw JS) |
| Manifest version | V2 (with V3 migration in progress) | V3 |
| i18n | 20+ languages | English only |
| Backup/Restore | zip.js export/import | JSON backup |

## 5.2 — INTEGRATION STRATEGY ANALYSIS

### QUESTION: Should we REPLACE our userscript engine with Violentmonkey's, or EMBED Violentmonkey's features?

**APPROACH A: EMBED VIOLENTMONKEY AS A SUB-EXTENSION**
- NOT possible — Chrome doesn't allow extensions to load other extensions

**APPROACH B: PORT VIOLENTMONKEY'S USERSCRIPT ENGINE INTO OUR EXTENSION**
- Replace our `userscript_engine.js` (341 lines) with VM's `injected/` module
- This is the RECOMMENDED approach
- Benefits:
  - Full GM API compatibility (GM_addStyle, GM_getValue, GM_setValue, GM_deleteValue,
    GM_listValues, GM_xmlhttpRequest, GM_notification, GM_setClipboard, GM_openInTab,
    GM_registerMenuCommand, GM_getResourceText, GM_getResourceURL, etc.)
  - Better @match/@include/@exclude pattern matching (VM uses tldts library)
  - Sandboxed script execution (VM's safe-globals.js)
  - Proper @require/@resource caching with update checks
  - Script execution ordering (VM handles @run-at properly)
  - Better error isolation (one script crash doesn't affect others)

**APPROACH C: ADD VIOLENTMONKEY UI TO OUR EXTENSION**
- Port VM's Vue-based popup and options pages
- Replace our vanilla JS popup/options with Vue 3 SPA
- This would be a MAJOR refactor but gives:
  - Full CodeMirror 5 script editor with syntax highlighting
  - Script list with enable/disable toggles
  - Import/export via zip
  - Multi-language support
  - Better UX

**APPROACH D: HYBRID (RECOMMENDED)**
- Keep our extension's core features (captcha, exam, autofill, STALL)
- Replace ONLY the userscript engine with VM's injected module
- Add VM's GM API implementation as a proper module
- Keep our simple options UI but add a "Open in Editor" button that opens VM-style editor
- Add VM's backup/restore format compatibility

## 5.3 — SPECIFIC INTEGRATION TASKS:

### TASK 5.3.1: Analyze VM's injected/index.js
- Clone the VM repo or fetch the raw source
- Understand how VM injects scripts into pages
- Map VM's injection flow to our current flow
- Identify conflicts with our content.js bootloader

### TASK 5.3.2: Analyze VM's GM API implementation
- Find VM's GM API bridge (likely in injected/content/ or injected/web/)
- Compare with our current GM shim in userscript_engine.js
- Identify missing APIs we should add
- Check @connect validation logic

### TASK 5.3.3: Analyze VM's storage layer
- VM uses IndexedDB via idb-keyval or similar
- Our extension uses chrome.storage.local
- Determine if we need to migrate storage or can wrap VM's API

### TASK 5.3.4: Analyze VM's @match/@include pattern matching
- VM uses the tldts library for URL parsing
- Our extension uses basic string matching
- VM supports @include (deprecated but still used), @match, @exclude
- Determine if we should adopt tldts or keep simple matching

### TASK 5.3.5: Create integration plan
- List files to add from VM
- List files to modify in our extension
- List files to remove from our extension
- Define migration path for existing userscripts
- Define testing strategy

## 5.4 — VIOLENTMONKEY SOURCE FILES TO FETCH AND ANALYZE:

Fetch these raw source files from GitHub:

1. `https://raw.githubusercontent.com/violentmonkey/violentmonkey/master/src/injected/index.js`
2. `https://raw.githubusercontent.com/violentmonkey/violentmonkey/master/src/injected/safe-globals.js`
3. `https://raw.githubusercontent.com/violentmonkey/violentmonkey/master/src/injected/content/index.js`
4. `https://raw.githubusercontent.com/violentmonkey/violentmonkey/master/src/injected/content/script-executor.js`
5. `https://raw.githubusercontent.com/violentmonkey/violentmonkey/master/src/injected/content/values.js`
6. `https://raw.githubusercontent.com/violentmonkey/violentmonkey/master/src/injected/web/gm-api.js`
7. `https://raw.githubusercontent.com/violentmonkey/violentmonkey/master/src/injected/web/index.js`
8. `https://raw.githubusercontent.com/violentmonkey/violentmonkey/master/src/background/index.js`
9. `https://raw.githubusercontent.com/violentmonkey/violentmonkey/master/src/background/messages.js`
10. `https://raw.githubusercontent.com/violentmonkey/violentmonkey/master/src/common/storage.js`
11. `https://raw.githubusercontent.com/violentmonkey/violentmonkey/master/src/common/script.js`
12. `https://raw.githubusercontent.com/violentmonkey/violentmonkey/master/src/common/util.js`

---

# ═══════════════════════════════════════════════════════════════
# PHASE 6: CROSS-CUTTING CONCERNS
# ═══════════════════════════════════════════════════════════════

## 6.1 — Data flow analysis
- Trace a captcha solve request from extension → backend → ONNX model → response
- Trace an exam solve request from extension → backend → LLM → response
- Trace an autofill rule from proposal → admin approval → sync to extension
- Trace a userscript from admin panel → backend storage → extension sync → injection
- Document any broken or missing links in these flows

## 6.2 — Error handling audit
- What happens when the backend is down?
- What happens when the ONNX model fails to load?
- What happens when chrome.storage.local is full?
- What happens when a content script fails to inject?
- What happens when the API key expires mid-operation?
- What happens when the LLM endpoint is unreachable?

## 6.3 — Configuration consistency
- Check all environment variables are documented
- Check all settings in platform_settings table are used
- Check for hardcoded URLs/ports that should be configurable
- Verify Docker vs bare-metal config parity

## 6.4 — Dependency audit
- Check requirements.txt for known vulnerable packages
- Check package.json for deprecated/unused dependencies
- Check for duplicate dependencies (e.g., two HTTP clients)
- Verify minimum versions are specified

---

# ═══════════════════════════════════════════════════════════════
# PHASE 7: DELIVERABLES
# ═══════════════════════════════════════════════════════════════

## 7.1 — Create BUG_REPORT.md
Document ALL bugs found, categorized by:
- CRITICAL: Security vulnerabilities, data loss, crashes
- HIGH: Broken features, incorrect behavior
- MEDIUM: Performance issues, missing error handling
- LOW: Code quality, missing comments, minor UX issues

Each bug entry should include:
- File path and line number
- Description of the issue
- Impact assessment
- Suggested fix

## 7.2 — Create VIOLENTMONKEY_INTEGRATION_PLAN.md
Document the complete integration plan:
- What to integrate (specific files/modules)
- How to integrate (step-by-step technical plan)
- What NOT to integrate (and why)
- Migration path for existing users
- Breaking changes and how to handle them
- Testing strategy
- Rollback plan

## 7.3 — Create CODE_QUALITY_REPORT.md
- Overall codebase health score (A-F)
- Technical debt inventory
- Architecture recommendations
- Refactoring priorities
- Test coverage gaps

## 7.4 — Create SECURITY_AUDIT.md
- All security vulnerabilities found
- Risk severity ratings
- Immediate fixes needed
- Long-term security recommendations

---

# ═══════════════════════════════════════════════════════════════
# EXECUTION ORDER
# ═══════════════════════════════════════════════════════════════

1. Phase 0: Environment setup & context loading (15 min)
2. Phase 1: Backend deep analysis (2-3 hours)
3. Phase 2: Frontend deep analysis (1-2 hours)
4. Phase 3: Extension deep analysis (2-3 hours) ← MOST IMPORTANT
5. Phase 4: Root config & infrastructure analysis (30 min)
6. Phase 5: Violentmonkey integration analysis (2-3 hours)
7. Phase 6: Cross-cutting concerns (1 hour)
8. Phase 7: Deliverables — write all 4 report documents (1-2 hours)

### PARALLEL EXECUTION HINTS:
- Phase 1, 2, 3, and 4 can be partially parallelized (read different files simultaneously)
- Phase 5 depends on Phase 3 completion (need to understand our userscript engine first)
- Phase 6 depends on Phase 1-4 completion
- Phase 7 is the final synthesis

---

# ═══════════════════════════════════════════════════════════════
# IMPORTANT NOTES
# ═══════════════════════════════════════════════════════════════

1. **DO NOT MODIFY ANY FILES** — this is a read-only analysis mission
2. **READ EVERY FILE LISTED** — don't skip any, even if they seem trivial
3. **DOCUMENT EVERYTHING** — every bug, every concern, every observation
4. **BE SPECIFIC** — include file paths and line numbers in all findings
5. **PRIORITIZE THE EXTENSION** — Phase 3 is the most critical and should get the most attention
6. **THINK LIKE AN ATTACKER** — for security analysis, consider how each feature could be exploited
7. **THINK LIKE A USER** — for UX analysis, consider the actual user workflow

---

## CRITICAL SECURITY ITEMS TO CHECK FIRST:
1. `/workspace/sa_helper/extension.pem` — is this a real private key? If so, FLAG IT IMMEDIATELY
2. `/workspace/sa_helper/rules_export.sql` — search for API keys, tokens, passwords
3. `/workspace/sa_helper/config/backend.env` — check for real secrets
4. `/workspace/sa_helper/config/.env` — check for real secrets
5. All `postMessage` calls with `'*'` targetOrigin in extension code
6. All `innerHTML` / `dangerouslySetInnerHTML` in frontend code
7. All string-formatted SQL queries in backend code
8. Admin route authentication guards

---

# START WORKING NOW. BEGIN WITH PHASE 0.