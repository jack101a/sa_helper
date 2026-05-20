# Codex 5.3 Feasibility Plan — Build-Safe Implementation Roadmap

Date: 2026-05-19  
Inputs reviewed:  
- `.ai-reports/01-deepseek-flash-map.md`  
- `.ai-reports/02-qwen-architecture-diagnosis.md`  
- `.ai-reports/03-gemini-pro-risk-analysis.md`  
- `.ai-reports/03-deepseek-v4-pro-risk-analysis.md`

## Executive Direction
Adopt an incremental **modular-monolith migration** with strict stabilization first. Do not start structural refactors until auth safety, migration safety, and baseline tests are in place.

## 1. Recommended Implementation Phases

### Phase 0 — Baseline Safety and Test Harness
- Freeze architecture scope and protect current behavior with tests around auth, key validation, and high-risk APIs.
- Add non-invasive observability and failure classification (explicit error codes, logs, smoke checks).

### Phase 1 — Auth and Routing Stabilization
- Remove ambiguous auth fallback behavior and make auth-path decisions explicit.
- Extract risky business logic from `backend/app/api/routes.py` into service-level units without changing endpoint contracts.

### Phase 2 — Database Migration Control
- Stop startup-time schema mutation in `database.py` from being the primary migration mechanism.
- Move legacy table evolution to Alembic-backed migrations with rollout/rollback gates.

### Phase 3 — Telegram/Background State Hardening
- Replace fragile file-state patterns with transactional persistence for bot/user-state and background flows.
- Normalize side-effects and retries for long-running/background operations.

### Phase 4 — Module Boundary Refactor (Backend)
- Transition from mixed-layer monolith to explicit modules (`captcha`, `exam`, `autofill`, `users`, `admin/shared`).
- Keep deployable unit single-process; enforce code boundaries and import direction.

### Phase 5 — Frontend/Extension Decoupling and Ops Fit
- Reduce `App.jsx` coordination bottleneck and split bootstrap-heavy data flow.
- Split extension/background orchestration risk hotspots into testable modules.

## 2. Exact Files Likely to Change

Backend core/auth/routes:
- `backend/app/middleware/auth_middleware.py`
- `backend/app/api/routes.py`
- `backend/app/api/admin_routes/analytics.py`
- `backend/app/api/admin_routes/auth.py`
- `backend/app/api/admin_routes/utils.py`
- `backend/app/core/database.py`
- `backend/app/core/db.py`
- `backend/app/core/models.py`
- `backend/app/core/container.py`
- `backend/app/core/config.py`
- `backend/app/core/security.py`
- `backend/app/main.py`

Backend services:
- `backend/app/services/exam_service.py`
- `backend/app/services/telegram_bot.py`
- `backend/app/services/key_service.py`
- `backend/app/services/user_key_service.py`
- `backend/app/services/backup_service.py`
- `backend/app/services/rate_limiter.py`
- `backend/app/services/usage_service.py`
- `backend/app/services/subscription_service.py`
- `backend/app/services/payment_service.py`

Backend repositories/migrations:
- `backend/app/core/repositories/api_keys.py`
- `backend/app/core/repositories/models.py`
- `backend/app/core/repositories/settings.py`
- `backend/app/core/repositories/autofill.py`
- `backend/app/core/repositories/exam.py`
- `backend/migrations/env.py`
- `backend/migrations/versions/*.py` (new migration files)
- `backend/alembic.ini`

Tests:
- `backend/tests/test_services.py`
- `backend/tests/test_extension_download.py`
- `backend/tests/` (new focused test modules)

Frontend:
- `frontend/src/app/App.jsx`
- `frontend/src/app/hooks/useAdminData.js`
- `frontend/src/api/queries.js`
- `frontend/src/app/components/SettingsPanel.jsx`
- `frontend/src/app/layout/DashboardLayout.jsx`

Extension:
- `extension/background.js`
- `extension/manifest.json`
- `extension/modules/userscript_engine.js`
- `extension/modules/userscript_runtime.js`
- `extension/modules/autofill.js`
- `extension/modules/exam.js`

## 3. New Files/Folders Likely Needed

Backend module structure (incremental, additive first):
- `backend/app/modules/captcha/`
- `backend/app/modules/exam/`
- `backend/app/modules/autofill/`
- `backend/app/modules/users/`
- `backend/app/modules/admin/`
- `backend/app/shared/`

Likely new files:
- `backend/app/services/userscript_access_service.py`
- `backend/app/services/automation_payload_service.py`
- `backend/app/services/report_rate_limit_service.py`
- `backend/app/services/telegram_state_store.py`
- `backend/app/services/auth_result_codes.py`
- `backend/app/core/repositories/interfaces.py`
- `backend/tests/test_auth_middleware.py`
- `backend/tests/test_api_routes_solve.py`
- `backend/tests/test_api_routes_exam.py`
- `backend/tests/test_rate_limit_behavior.py`
- `backend/tests/test_telegram_state_store.py`

Frontend split candidates:
- `frontend/src/app/context/AdminDataContext.jsx` (or equivalent state provider)
- `frontend/src/app/components/settings/` (sectionized settings components)

Extension split candidates:
- `extension/modules/background/router.js`
- `extension/modules/background/state.js`
- `extension/modules/background/api_client.js`

## 4. Files That Must Be Changed Sequentially

Strict sequence A (auth correctness):
1. `backend/tests/test_auth_middleware.py` (new)
2. `backend/app/middleware/auth_middleware.py`
3. `backend/app/services/user_key_service.py`
4. `backend/app/services/key_service.py`
5. `backend/app/api/routes.py` (only auth-touching points)

Strict sequence B (migration control):
1. `backend/migrations/versions/*.py` (create migration scripts)
2. `backend/migrations/env.py` and `backend/alembic.ini` (if needed)
3. `backend/app/core/database.py` (de-scope inline migration behavior)
4. `backend/app/core/container.py` / `backend/app/main.py` startup behavior

Strict sequence C (telegram state hardening):
1. `backend/tests/test_telegram_state_store.py` (new)
2. `backend/app/services/telegram_state_store.py` (new)
3. `backend/app/services/telegram_bot.py`
4. `backend/app/core/models.py` + migrations if new table(s)

## 5. Files That Can Be Worked on in Parallel

Parallel lane 1 (routes extraction):
- `backend/app/api/routes.py`
- `backend/app/services/userscript_access_service.py` (new)
- `backend/app/services/automation_payload_service.py` (new)
- `backend/app/services/report_rate_limit_service.py` (new)

Parallel lane 2 (frontend decoupling):
- `frontend/src/app/App.jsx`
- `frontend/src/app/hooks/useAdminData.js`
- `frontend/src/api/queries.js`
- `frontend/src/app/components/SettingsPanel.jsx`

Parallel lane 3 (extension modularization):
- `extension/background.js`
- `extension/modules/background/*.js` (new)
- `extension/modules/userscript_engine.js`

Parallel lane 4 (test expansion):
- `backend/tests/test_api_routes_solve.py` (new)
- `backend/tests/test_api_routes_exam.py` (new)
- `backend/tests/test_rate_limit_behavior.py` (new)

## 6. Files That Should Be Owned Only by Main Build Agent

Single-owner only due to high blast radius:
- `backend/app/core/database.py`
- `backend/app/core/db.py`
- `backend/app/core/models.py`
- `backend/app/middleware/auth_middleware.py`
- `backend/app/core/security.py`
- `backend/app/core/container.py`
- `backend/app/main.py`
- `backend/migrations/env.py`
- `backend/migrations/versions/*.py`
- `extension/manifest.json`
- `docker-compose.yml`
- `Dockerfile`

## 7. Commands to Run Per Phase

Phase 0:
- `cd backend && pytest -q`
- `cd backend && pytest -q -k "auth or key or exam"`
- `cd backend && python -m compileall app`

Phase 1:
- `cd backend && pytest -q backend/tests/test_auth_middleware.py`
- `cd backend && pytest -q backend/tests/test_api_routes_solve.py backend/tests/test_api_routes_exam.py`
- `cd backend && uvicorn app.main:app --host 127.0.0.1 --port 8080`

Phase 2:
- `cd backend && alembic current`
- `cd backend && alembic upgrade head`
- `cd backend && pytest -q -k "migration or repository or auth"`

Phase 3:
- `cd backend && pytest -q backend/tests/test_telegram_state_store.py`
- `cd backend && pytest -q -k "telegram or backup or queue"`

Phase 4:
- `cd backend && pytest -q`
- `cd backend && uvicorn app.main:app --host 127.0.0.1 --port 8080`

Phase 5:
- `cd frontend && npm ci && npm run build`
- `cd frontend && npm run dev`
- `cd backend && pytest -q`

## 8. Tests to Add/Update Per Phase

Phase 0:
- Add `test_auth_middleware.py` covering user-key/legacy-key/device mismatch/revoked/blocked paths.
- Add regression tests for `/v1/solve`, `/v1/exam/solve`, `/v1/exam/feedback` status and shape.

Phase 1:
- Add unit tests for extracted services from `routes.py` helpers.
- Update route tests to verify identical API contract before/after extraction.

Phase 2:
- Add migration safety tests validating schema forward migration on a seeded DB snapshot.
- Add repository compatibility tests (legacy + ORM pathway consistency).

Phase 3:
- Add telegram state persistence tests for crash/restart and concurrent updates.
- Add background task retry/failed-write behavior tests.

Phase 4:
- Add module boundary tests (import direction and interface usage).
- Add integration tests per module (`captcha`, `exam`, `autofill`, `users`).

Phase 5:
- Frontend tests for split data-fetching flow and panel-level rendering.
- Extension smoke tests for message routing and userscript execution path.

## 9. Build/Lint/Typecheck Verification Plan

Backend:
- Build/runtime: `python -m compileall app`, `uvicorn app.main:app ...`
- Tests: `pytest -q`
- Optional quality gates (if introduced): `ruff check`, `mypy app` (incremental adoption)

Frontend:
- Build: `npm run build`
- Dev smoke: `npm run dev`
- Lint/typecheck (if configured): `npm run lint`, `npm run typecheck`

Extension:
- Manifest validation via load-unpacked smoke test
- Runtime smoke: background startup + content-script messaging on target pages

Release gate per phase:
- No phase closes unless tests pass, startup succeeds, and no new high-severity auth/data risks are introduced.

## 10. Risk Level Per Phase

- Phase 0: **Low** (test scaffolding, observability)
- Phase 1: **Medium-High** (auth path and route extraction)
- Phase 2: **High** (schema/migration control and startup behavior)
- Phase 3: **Medium** (state persistence and side effects)
- Phase 4: **Medium-High** (module moves and dependency rewiring)
- Phase 5: **Medium** (frontend/extension refactor with UX/runtime coupling)

## 11. Rollback Plan Per Phase

Phase 0 rollback:
- Revert test-only commits; no data impact.

Phase 1 rollback:
- Feature-flag or revert auth-path changes immediately.
- Restore previous `auth_middleware.py` and `routes.py` from tagged commit.

Phase 2 rollback:
- Always snapshot SQLite DB and any SQLAlchemy DB before migration.
- On failure: restore DB snapshot, revert migration commit, pin to previous application image/tag.

Phase 3 rollback:
- Keep legacy telegram JSON state read-compatibility for one release.
- On failure: switch to legacy state adapter and replay pending operations.

Phase 4 rollback:
- Keep old module import shims during transition.
- Revert module registration changes while preserving already-passing tests.

Phase 5 rollback:
- Frontend: revert to prior `App.jsx`/query composition.
- Extension: republish prior package/manifest version and disable new background modules.

## 12. What Should Not Be Changed

- Do not change key hashing algorithm/salt semantics in `backend/app/core/security.py` without explicit key-migration design.
- Do not remove legacy auth path until parity tests and migration cutover criteria are met.
- Do not change endpoint paths or response schemas for public `/v1/*` and admin APIs during stabilization phases.
- Do not refactor `database.py` and Alembic behavior in the same PR without rollback checkpoints.
- Do not alter extension permission scope in `extension/manifest.json` during architecture-only phases.
- Do not introduce new frameworks/infrastructure (microservices, new queues) before modular-monolith boundary stabilization.

## 13. Final Go/No-Go Recommendation

**Recommendation: GO with guardrails.**

Go criteria:
- Phase 0 completed with new auth/API regression tests passing.
- Pre-migration backup and restore drill validated before Phase 2.
- Single-owner control enforced for auth, DB, migration, and startup files.

No-go triggers:
- Inability to produce deterministic migration rollback in staging.
- Auth behavior ambiguity still present after Phase 1 tests.
- Any Phase 2 change that requires irreversible schema mutation without tested restore path.

Net assessment:
- The architecture direction is feasible and buildable if executed incrementally with test-first gating and strict ownership on high-blast-radius files.
