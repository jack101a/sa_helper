# INFRA_PLAN.md — Remaining Infrastructure & Code Quality Items

## Scope
13 items (I-008, I-009, Alembic fix, Dockerfile merge, frontend tests, backend integration tests, error handling, code smells, config consolidation, dual DB systems, TypeScript, test coverage, build systems)

## Constraints
- No behavior changes that break existing deployment
- No DB migration to SQLAlchemy (deferred to separate project)
- No TypeScript migration (deferred to separate project)
- Alembic fix must not break `Base.metadata.create_all()` workflows
- Tests must not touch production DB
- No removal of Dockerfiles/docker-compose files unless superset proven

---

# PHASE 1: SAFE_NOW — Zero-deployment-risk changes (do these first)

## Item 1: I-008 — Resolve inconsistent Dockerfiles with a documentation-only canonical declaration

**Risk:** SAFE_NOW
**Reasoning:** The root `Dockerfile` is used by CI (publish-api.yml, docker.yml). The `infra/backend/Dockerfile` is **not referenced by any CI workflow or compose file**. It's effectively dead/unused code. Both use the same `ghcr.io/jack101a/sa-helper:latest` image tag.

**Decision:** Root `Dockerfile` is canonical. `infra/backend/Dockerfile` is stale.

**Action:** Add a comment header to `infra/backend/Dockerfile` declaring it deprecated superseded by root Dockerfile. **Do NOT delete it** — deleting could break unreferenced manual builds.

**Exact change:**
```
File: /workspace/sa_helper/infra/backend/Dockerfile
Prepend these lines:
# ⚠ DEPRECATED — Canonical Dockerfile is at repo root: /Dockerfile
# This file is superseded by the root multi-stage Dockerfile which includes
# the frontend build step. CI workflows use the root Dockerfile.
# This file is kept for reference only and will be removed in v3.0.
```

---

## Item 2: I-009 — Resolve duplicate docker-compose.yml

**Risk:** SAFE_NOW
**Reasoning:** Root `docker-compose.yml` is the canonical deployment config (used by `docker-compose up` from repo root). `infra/docker-compose.yml` is a deployment override that adds a static IP on an external network (`ajax_network`). The infra version has hardcoded default credentials (`test12345678`, `admin123`, `123456`) — these were already cleaned in the root compose file during Phase 1.

**Decision:** Root `docker-compose.yml` is canonical. `infra/docker-compose.yml` is a site-specific deployment override (Gitea/docker-compose setup with static IP).

**Action:** Same as above — add deprecation header to `infra/docker-compose.yml` documenting that the root compose file is canonical and this one is a Gitea-specific override. Also clean the hardcoded defaults in the infra version (same fix as G4).

**Exact changes:**
```
File: /workspace/sa_helper/infra/docker-compose.yml
1. Prepend:
# ⚠ DEPRECATED — Canonical docker-compose.yml is at repo root: /docker-compose.yml
# This file is a Gitea-specific deployment override that adds:
#   - Static IP 172.60.0.63 on external network ajax_network
#   - Healthcheck definition
# For general use, run: docker compose -f docker-compose.yml up

2. Fix lines 18-20 (hardcoded creds — same as G4 fix):
   - AUTH_HASH_SALT:-test12345678} → AUTH_HASH_SALT:-}
   - ADMIN_TOKEN:-admin123} → ADMIN_TOKEN:-}
   - ADMIN_PASSWORD:-123456} → ADMIN_PASSWORD:-}
```

---

## Item 3: Alembic migration fix (P1 from CODE_QUALITY_REPORT)

**Risk:** SAFE_WITH_CARE
**Reasoning:** Current state:
- Migration `94bfa105be00` has empty `upgrade()`/`downgrade()` — does nothing
- Migration `b2c3d4e5f678` ALTERs columns on tables that don't exist at migration time
- Tables (users, payment_records, user_api_keys, etc.) are created by `Base.metadata.create_all()` in `container.py:71`
- `create_all()` only creates tables if they don't exist — it's effectively idempotent
- If someone runs `alembic upgrade head` on a fresh DB, migration b2c3d4e5f678 will fail because tables don't exist

**Safe fix:** Fill in migration `94bfa105be00` with the actual `create_all()` SQL (CREATE TABLE statements). Make migration `b2c3d4e5f678` wrap its ALTERs to handle case where tables already exist (for DBs created by `create_all()`). Add `IF NOT EXISTS` guards or catch operational errors.

**Exact change:**
```
File: /workspace/sa_helper/backend/migrations/versions/94bfa105be00_initial_schema.py
Replace empty upgrade() with CREATE TABLE IF NOT EXISTS for all SQLAlchemy-managed tables:
  - users
  - subscription_plans
  - user_subscriptions
  - payment_records
  - user_api_keys
  - user_api_key_devices
  - usage_cycles
  - audit_logs
  - request_jobs
  - backup_runs

Replace empty downgrade() with DROP TABLE IF EXISTS in reverse order.

File: /workspace/sa_helper/backend/migrations/versions/b2c3d4e5f678_add_payment_and_key_tracking_fields.py
Wrap each op.add_column() in a try/except that catches the case where the column already exists (OperationalError for "duplicate column").
```

**Verification:** Fresh SQLite DB, run `alembic upgrade head` — must succeed. Existing DB with tables from `create_all()` — run `alembic upgrade head` — must succeed (idempotent).

---

## Item 4: Dockerfile merge (P2 from CODE_QUALITY_REPORT)

**Risk:** SAFE_WITH_CARE
**Reasoning:** The root `Dockerfile` is multi-stage and builds both frontend and backend. The `infra/backend/Dockerfile` is a backend-only build. Since CI uses root Dockerfile, the infra one is only useful for local development where you want to skip the frontend build.

**Decision:** Do NOT merge. Instead, make the root Dockerfile accept a build arg `FRONTEND_BUILD=true` (default) and `FRONTEND_BUILD=false` to skip the frontend build step. Then deprecate infra/backend/Dockerfile.

**Action:**
```
File: /workspace/sa_helper/Dockerfile
1. Add: ARG FRONTEND_BUILD=true
2. Wrap frontend-builder stage in a conditional (or use --target)
3. Add: ARG SKIP_FRONTEND=false (alternative approach: copy from frontend-prebuilt dir if exists)

Simpler approach: Just document the infra/backend/Dockerfile as deprecated (Item 1 above).
The root multi-stage Dockerfile already covers all production use cases.
```

**Actual action:** Item 1 above already handles this. The two Dockerfiles serve different environments — root for CI/production, infra for local backend-only dev. Document this clearly and move on.

---

## Item 5: Config consolidation

**Risk:** SAFE_WITH_CARE
**Reasoning:** Four config sources:
1. **YAML config** (`backend/config/config.yaml`) — file-based defaults
2. **.env file** (`config/.env`) — loaded by python-dotenv
3. **Environment variables** — Docker/OS env vars
4. **DB platform_settings table** — runtime-settable via admin dashboard

The actual priority chain (from `config.py:get_settings()`):
1. Hardcoded `_DEFAULT_CONFIG` (lowest)
2. YAML file overrides defaults
3. Environment variables override YAML (highest at startup)
4. `platform_settings` table is NOT loaded at startup — it's queried at runtime by services (e.g., AlertService reads from DB)

This is actually a well-structured config system, similar to how many production Python apps work. The problem is that it's not documented.

**Action:** Add a block comment in `config.py` explaining the priority chain. No code changes needed.

**Exact change:**
```
File: /workspace/sa_helper/backend/app/core/config.py
Add this comment block after the module docstring (around line 3):

# Config priority (lowest to highest):
#   1. _DEFAULT_CONFIG dict (hardcoded in this file)
#   2. config/config.yaml or CONFIG_PATH env var → YAML file
#   3. .env file (loaded from project_root/config/.env by python-dotenv)
#   4. Environment variables (AUTH_HASH_SALT, ADMIN_TOKEN, etc.)
# Runtime config (read after startup):
#   5. platform_settings table in SQLite — queried by services at runtime
#      (AlertService, AuthService, etc. read their config from DB)
```

---

## Item 6: Standardize API error handling

**Risk:** SAFE_NOW (non-breaking, additive only)
**Reasoning:** Current state: mix of `raise HTTPException(status_code=X, detail="msg")`, `return JSONResponse({"error": "msg"}, status_code=X)`, and `return JSONResponse({"ok": False, "message": "msg"}, status_code=X)`. All patterns work fine — just inconsistent.

**Action:** Add a utility module with standardized error response helpers. Do NOT change existing calls — just make the helpers available for new code.

**Exact change:**
```
File: /workspace/sa_helper/backend/app/api/errors.py (NEW FILE)

from fastapi import HTTPException
from fastapi.responses import JSONResponse

def api_error(status_code: int, detail: str) -> HTTPException:
    """Standard API error for route handlers that use exception handling."""
    return HTTPException(status_code=status_code, detail=detail)

def error_response(status_code: int, message: str) -> JSONResponse:
    """Standard error JSON response. Use in handlers that return JSON."""
    return JSONResponse({"ok": False, "error": message}, status_code=status_code)

def not_found(entity: str = "Resource") -> HTTPException:
    return HTTPException(status_code=404, detail=f"{entity} not found")

def bad_request(detail: str) -> HTTPException:
    return HTTPException(status_code=400, detail=detail)
```

---

## Item 7: Code smells — Document magic numbers

**Risk:** SAFE_NOW (comments only, no behavior change)
**Reasoning:** Magic numbers (`colSpan={99}`, `max_tokens: 5`, unnamed polling intervals) exist but changing them risks subtle regressions. The safe approach is to document them with named constants.

**Action:** Add comments explaining what each magic number represents. Use named constants where the value is used in multiple places.

**Exact changes (spot-fix only the easiest):**
```
1. Search for colSpan={99} — add comment: {/* 99 = intentional "full-width" sentinel */}
2. Search for max_tokens: 5 — if in exam service, add comment explaining why 5
3. Search for setInterval with unnamed polling — use POLL_INTERVAL_MS = XXXX constant

NO semantic changes. Only comments and local const declarations.
```

---

# PHASE 2: SAFE_WITH_CARE — Requires specific precautions

## Item 8: Two database systems coexisting

**Risk:** SAFE_WITH_CARE
**Reasoning:** Two connection pools to the same SQLite file:
- `Database` class (`database.py`) — raw sqlite3 with `threading.Lock`, creates its own connections
- SQLAlchemy engine (`db.py`) — SQLAlchemy connection pool with `NullPool` for migrations

These coexist and work because SQLite WAL mode allows multiple readers. Writers are serialized by SQLite internally. The risk is that raw sqlite3 connections bypass SQLAlchemy's connection management.

**Action:** Document the coexistence and ensure both use the same WAL pragma. Add a warning comment in `db.py` and `database.py` cross-referencing each other. No structural changes.

**Exact change:**
```
File: /workspace/sa_helper/backend/app/core/db.py
Add after docstring:
# ⚠ COEXISTENCE: This module (SQLAlchemy ORM) shares the same SQLite file
# with the legacy raw-SQL Database facade in app/core/database.py.
# Both use WAL mode for concurrent access. Do NOT change the DB path
# without updating both files. Migration to single ORM is planned for v3.0.

File: /workspace/sa_helper/backend/app/core/database.py
Add after docstring:
# ⚠ COEXISTENCE: This module (raw SQLite) shares the same SQLite file
# with the SQLAlchemy ORM engine in app/core/db.py.
# Both use WAL mode for concurrent access. See db.py for ORM models.
```

---

## Item 9: Two build/package systems

**Risk:** SAFE_NOW (documentation only)
**Reasoning:** The extension is raw JS because it needs to run directly in the browser. The frontend uses Vite because it's a React SPA. The backend uses FastAPI/uvicorn. These are not "competing" — they're appropriate for their domains. The two Dockerfiles serve different CI/CD contexts.

**Action:** Write documentation block clarifying why each exists. No file changes.

---

# PHASE 3: NEEDS_COORDINATION — Depends on other changes

## Item 10: Add frontend unit tests (Vitest setup)

**Risk:** NEEDS_COORDINATION
**Reasoning:** Can be done safely but needs:
1. Vitest added to `frontend/package.json` devDependencies
2. Test files must NOT import components that make HTTP calls to production API
3. Test DB/data must be isolated

**Plan:** This is a standalone task that can be done after Phase 1 and 2. Not dangerous but requires a full TASK.md.

---

## Item 11: Add backend integration tests

**Risk:** NEEDS_COORDINATION
**Reasoning:** Existing 2 test files are fragile (use temp dirs, MagicMock, unittest). Need:
1. `pytest` fixture for isolated test DB
2. `conftest.py` with FastAPI TestClient fixture
3. Test DB path must be different from production (`:memory:` or temp file)
4. Must not call `container.py` which does `create_all_tables()` on real path

**Plan:** This is a standalone task that can be done after Phase 1 and 2. Not dangerous but requires a full TASK.md.

---

# PHASE 4: DEFER — Too risky or too large for now

## Item 12: TypeScript migration

**Risk:** DEFER
**Reasoning:** Explicitly deferred per project plan (TASK_QUEUE.md line 31). Converting 30+ JSX files and extension JS files to TypeScript is a 2-4 week project with high risk of introducing type errors that break the build.

---

## Item 13: No test coverage

**Risk:** DEFER
**Reasoning:** This is not a single task — it's a meta-status that will be addressed by Items 10 and 11. Backend <5%, frontend 0%, extension 0% is expected for a pre-release stage. Add tests incrementally per Items 10-11.

---

# EXECUTION ORDER

1. **Phase 1a** (Items 1, 2) — Deprecation comments, zero code risk, ~5 min
2. **Phase 1b** (Item 6) — Error helper module, new file only, ~5 min
3. **Phase 1c** (Item 5) — Config documentation comment, ~2 min
4. **Phase 1d** (Item 7) — Magic number comments, ~10 min
5. **Phase 1e** (Item 3) — Alembic migrations fix, ~20 min
6. **Phase 2a** (Item 8) — DB coexistence docs, ~5 min
7. **Phase 2b** (Item 4) — Dockerfile documentation, ~5 min
8. **Phase 3a** (Item 10) — Vitest setup, ~45 min
9. **Phase 3b** (Item 11) — Backend test infra, ~45 min

Total estimated effort: ~2.5 hours

---

# Items NOT included (by design)

- **TypeScript migration** — DEFER (separate project)
- **Legacy DB → SQLAlchemy migration** — DEFER (separate project)
- **Package system consolidation** — NOT NEEDED (extension=raw JS, frontend=Vite, backend=FastAPI — appropriate for each domain)
- **Dockerfile merge** — NOT NEEDED (root multi-stage covers production, infra one is local dev shortcut)
- **Config system consolidation** — NOT NEEDED (YAML + .env + env vars + DB table is standard layered config pattern)
- **Removing either Dockerfile** — UNSAFE (could break unreferenced manual deployments)