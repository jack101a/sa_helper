# 05 — Final Architecture Plan (Opus)

> **Author**: Claude Opus (Senior Architect)  
> **Date**: 2026-05-19  
> **Scope**: Full-project architecture, refactoring, migration, deployment, backup, and scaling plan  
> **Codebase Commit**: `5e64786`

---

## Document Index

This plan is split across multiple files for readability:

| Document | Covers |
|----------|--------|
| **[05 — Master Plan](./05-opus-final-architecture-plan.md)** (this file) | Core architecture, DB unification, modular monolith, security |
| **[05a — Capacity & Deployment](./05a-capacity-and-deployment.md)** | Oracle VPS sizing, 20 concurrent captcha / 4 MCQ targets, Docker production, future scaling |
| **[05b — Telegram Registration & Plans](./05b-telegram-registration-and-plans.md)** | Full auto-registration, admin plan CRUD, service/device entitlements, subscription lifecycle |
| **[05c — MCQ Auto-Training Pipeline](./05c-mcq-auto-training-pipeline.md)** | Automatic training from extension feedback, auto-merge to main question bank, OCR quality |
| **[05d — Backup & Restore System](./05d-backup-restore-system.md)** | System vs user backups, rclone integration, Telegram channel backup, restore procedures |

---

## Executive Summary

This is a **Unified SaaS Platform** comprising:
- **Backend**: FastAPI (Python 3.11), dual database (raw SQLite + SQLAlchemy ORM)
- **Frontend**: React SPA (Vite, TailwindCSS), admin dashboard
- **Extension**: MV3 Chrome/Firefox browser extension (17 content scripts, no bundler)
- **Telegram Bot**: User registration, payment flow, key management
- **Docker**: Multi-stage build, compose with separate bot container

The platform serves **4 core services**: Text Captcha (ONNX), MCQ Exam Solver (Hash→OCR→LLM), Form Autofill, and STALL Automation — all gated by API keys with per-user subscriptions and UPI payments via Telegram.

### Critical Findings from Codebase Inspection

| Finding | Severity | Location |
|---------|----------|----------|
| Dual-database split (raw SQLite vs SQLAlchemy) with no cross-DB referential integrity | **HIGH** | `database.py` + `db.py` |
| 561-line God Object facade with 100+ proxy methods | **HIGH** | `database.py` |
| Inline DDL migrations (~120 lines of ALTER TABLE) run on every startup | **HIGH** | `database.py:100-437` |
| Telegram bot state persisted to JSON file on disk | **MEDIUM** | `telegram_bot.py:85` |
| Auth middleware silently falls through on user-key errors | **MEDIUM** | `auth_middleware.py:117-119` |
| Only 2 test files, zero integration tests | **HIGH** | `backend/tests/` |
| `create_all_tables()` called in container init (bypasses Alembic) | **MEDIUM** | `container.py:70-71` |
| Backup service hardcoded to SQLite `sqlite3.backup()` API | **MEDIUM** | `backup_service.py` |
| In-memory rate limiter lost on restart/multi-worker | **LOW** | `rate_limiter.py` |
| Extension has no bundler — raw JS files loaded via manifest | **LOW** | `manifest.json` |

---

## Phase 0: Stabilization (IMMEDIATE — Week 1-2)

> **Goal**: Create safety net before any structural changes.

### 0.1 Test Harness

Create `backend/tests/` structure:

```
tests/
├── conftest.py              # Shared fixtures (test DB, test client, mock container)
├── test_auth_middleware.py   # Auth flow: valid key, expired, blocked, device mismatch, fallthrough
├── test_solve_endpoint.py   # /v1/solve happy path + error cases
├── test_exam_endpoint.py    # /v1/exam/solve + /v1/exam/feedback
├── test_admin_guard.py      # Cookie auth, proxy identity, login redirect
├── test_key_service.py      # Key generation, hashing, validation, device binding
├── test_backup_service.py   # Backup create, list, restore
```

**Priority tests** (block all refactoring until green):
1. `test_auth_middleware.py` — The dual-key fallthrough logic is the riskiest code path
2. `test_exam_endpoint.py` — The exam feedback learning loop is business-critical
3. `test_admin_guard.py` — Cookie + proxy identity auth

### 0.2 CI Pipeline

```yaml
# .github/workflows/ci.yml
name: CI
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: "3.11" }
      - run: pip install -r backend/requirements.txt && pip install pytest httpx
      - run: pytest backend/tests/ -v --tb=short
        env:
          AUTH_HASH_SALT: test-salt
          ADMIN_TOKEN: test-token
  docker:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: docker build -t sa-helper:ci .
      - run: |
          docker run -d --name ci-test \
            -e AUTH_HASH_SALT=test -e ADMIN_TOKEN=test \
            -p 8080:8080 sa-helper:ci
          sleep 5
          curl -f http://localhost:8080/health
```

### 0.3 Fix Auth Middleware Silent Swallowing

**Current** (`auth_middleware.py:117-119`):
```python
except Exception as e:
    logger.warning("user_key_check_failed", ...)
    return None  # Fall through to legacy on error
```

**Change**: Log at ERROR level, add structured error type. Do NOT change the fallthrough behavior yet — just make it observable.

---

## Phase 1: Database Unification (Week 2-4)

> **Goal**: Eliminate dual-database split. Single SQLAlchemy engine for everything.

### 1.1 Current State

| System | Engine | Tables | Used By |
|--------|--------|--------|---------|
| Legacy | raw `sqlite3` via `Database` facade | 18 tables (api_keys, usage_events, model_routes, exam_learned, etc.) | KeyService, ExamService, AutofillService, ModelRouter, UsageService |
| New | SQLAlchemy ORM via `db.py` | 9 tables (users, subscriptions, payments, user_api_keys, etc.) | UserService, SubscriptionService, PaymentService, TelegramBot |

Both point to the **same SQLite file** (`backend/logs/app.db`) but use different connection mechanisms.

### 1.2 Migration Strategy

**Step 1**: Create SQLAlchemy models for all 18 legacy tables (mirror existing DDL exactly).

```
backend/app/core/legacy_models.py  # [NEW] — SQLAlchemy models for legacy tables
```

**Step 2**: Create repository adapters that use SQLAlchemy sessions instead of raw `sqlite3`.

```
backend/app/core/repositories_v2/   # [NEW] — SQLAlchemy-based repos
├── api_keys.py
├── models.py
├── autofill.py
├── exam.py
├── exam_attempts.py
├── exam_learned.py
├── training.py
├── settings.py
└── automation_methods.py
```

**Step 3**: Swap repositories in `Database.__init__()` one at a time, with feature flags:
```python
if os.getenv("USE_SQLALCHEMY_REPOS", "").lower() in ("1", "true"):
    self.api_keys = APIKeyRepositoryV2(session_factory)
else:
    self.api_keys = APIKeyRepository(self)  # legacy
```

**Step 4**: Once all repos migrated, remove the raw `sqlite3` `connect()` method and inline DDL.

**Step 5**: Generate proper Alembic migrations for the full unified schema.

### 1.3 Remove `create_all_tables()` from Production

In `container.py:69-71`:
```python
# Create tables if they don't exist (dev convenience; production uses migrations)
from app.core.db import create_all_tables
create_all_tables()
```

**Change**: Guard behind `DEBUG` flag, use Alembic in production:
```python
if settings.server.debug:
    from app.core.db import create_all_tables
    create_all_tables()
```

### 1.4 Alembic Formalization

Current state: 2 migration files exist but `create_all_tables()` bypasses them.

**Action**:
1. Generate a comprehensive baseline migration from the unified schema
2. Remove all inline DDL from `database.py:100-437`
3. Add `alembic upgrade head` to `docker-entrypoint.sh`
4. Add migration check to CI

---

## Phase 2: Modular Monolith (Week 4-6)

> **Goal**: Explicit module boundaries without microservice overhead.

### 2.1 Target Module Structure

```
backend/app/
├── core/              # Shared infrastructure (config, db, security, logging)
├── middleware/         # HTTP middleware (auth, rate limit, logging)
├── modules/
│   ├── captcha/       # ONNX solver, model router, cache, retrain
│   │   ├── service.py
│   │   ├── routes.py
│   │   └── models.py
│   ├── exam/          # MCQ solver (hash, OCR, LLM), self-learning, feedback
│   │   ├── service.py
│   │   ├── routes.py
│   │   └── models.py
│   ├── autofill/      # Form autofill rules, proposals, locators
│   │   ├── service.py
│   │   ├── routes.py
│   │   └── models.py
│   ├── users/         # User management, subscriptions, payments, keys
│   │   ├── service.py
│   │   ├── routes.py
│   │   └── models.py
│   ├── automation/    # STALL automation, userscripts
│   │   ├── service.py
│   │   ├── routes.py
│   │   └── models.py
│   └── admin/         # Admin dashboard, analytics, backups, settings
│       ├── routes/    # (current admin_routes/ contents)
│       └── service.py
├── api/               # Thin router composition only
│   ├── routes.py      # /v1/* → module routes
│   └── admin.py       # /admin/* → module routes
└── services/          # [DEPRECATED] — gradually empty as modules absorb
```

### 2.2 Migration Rules

1. **Move one module at a time** — start with `captcha` (simplest, fewest dependencies)
2. **Each module owns its routes, service, and models** — no cross-module direct imports
3. **Shared data access** via the container, never by importing another module's service
4. **The `Database` facade becomes a thin pass-through** to module repositories
5. **routes.py shrinks** to just router includes — all logic moves into module routes

### 2.3 Container Evolution

```python
@dataclass
class Container:
    settings: Settings
    db_session_factory: Callable  # Single session factory
    
    # Module services
    captcha: CaptchaModule
    exam: ExamModule
    autofill: AutofillModule
    users: UserModule
    automation: AutomationModule
    admin: AdminModule
    
    # Cross-cutting
    alert_service: AlertService
    backup_service: BackupService
    extension_service: ExtensionService
```

---

## Phase 3: Frontend & Extension (Week 6-8)

### 3.1 Frontend State Management

**Current problem**: `App.jsx` (221 lines) manages 15+ `useState` hooks and passes them as props through 5 layers. All admin data fetched in `useAdminData` hook.

**Solution**: Introduce lightweight context-based state management per module:

```
frontend/src/app/
├── context/
│   ├── ThemeContext.jsx    # [EXISTS]
│   ├── AdminDataContext.jsx  # [NEW] — replaces useAdminData prop drilling
│   └── ToastContext.jsx      # [NEW] — replaces toast prop drilling
├── modules/
│   ├── dashboard/
│   ├── exam/
│   ├── settings/
│   └── subscriptions/
```

### 3.2 Extension Build Pipeline

**Current**: Raw JS files, no bundling, no minification.

**Add**: Simple esbuild or rollup config for:
- Bundle validation (catch import errors at build time)
- Source maps for debugging
- Version stamping from `manifest.json`

```json
// package.json [NEW] in extension/
{
  "scripts": {
    "validate": "esbuild --bundle --outdir=dist --analyze background.js",
    "package": "node scripts/package.js"
  }
}
```

This does NOT change the extension's runtime architecture — MV3 still loads raw files. It just adds a build-time validation step.

---

## Phase 4: Deployment & Operations (Week 8-10)

### 4.1 Docker Improvements

**Current issues** (from conversation `97b750d4`):
- Permission errors with non-root users
- PostgreSQL auth failures from stale volumes
- Config seeding races

**Fixes**:

1. **Entrypoint hardening** (`docker-entrypoint.sh`):
```bash
#!/bin/sh
set -eu

# Seed defaults (no-clobber)
seed_path "/opt/sa-helper-seed/data" "/app/data"
seed_path "/opt/sa-helper-seed/backend/config" "/app/backend/config"

# Ensure directories
mkdir -p /app/backend/logs /app/backend/app/static/extensions /app/backend/app/templates

# Run Alembic migrations
cd /app/backend && python -m alembic upgrade head

exec "$@"
```

2. **Health check enhancement**:
```dockerfile
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD curl -sf http://localhost:8080/health | grep -q '"status":"ok"' || exit 1
```

3. **PostgreSQL compose profile** (for production):
```yaml
services:
  sa-helper:
    environment:
      - DB_TYPE=postgresql
      - DATABASE_URL=postgresql://app:${DB_PASSWORD}@postgres:5432/unified_platform
    depends_on:
      postgres:
        condition: service_healthy

  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: unified_platform
      POSTGRES_USER: app
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - pg_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app"]
      interval: 5s
      timeout: 3s
      retries: 5
```

### 4.2 Telegram Bot Isolation

**Current**: Bot runs as separate container sharing the same SQLite file via Docker volume. This causes **write contention** with the API server.

**Fix for SQLite mode**: Use WAL mode (already set) + ensure bot only reads, API writes. The bot already uses SQLAlchemy sessions which handle this.

**Fix for PostgreSQL mode**: No issue — PostgreSQL handles concurrent connections natively.

**State persistence** (`telegram_user_states.json`):
- Short-term: Keep as-is (files are on shared volume)
- Medium-term: Move to Redis or a `telegram_states` DB table
- The 30-minute TTL already handles stale state cleanup

### 4.3 Backup Strategy

**Current**: `BackupService` uses `sqlite3.backup()` — only works for SQLite.

**PostgreSQL backup**:
```python
def full_backup(self) -> dict:
    if self._settings.storage.db_type == "postgresql":
        return self._pg_dump_backup()
    return self._sqlite_backup()

def _pg_dump_backup(self) -> dict:
    # Use pg_dump via subprocess
    import subprocess
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    backup_file = self._backup_dir / f"backup_{timestamp}.sql"
    result = subprocess.run(
        ["pg_dump", "--format=custom", "--file", str(backup_file)],
        env={**os.environ, "PGPASSWORD": self._settings.storage.database_url.split(":")[-1].split("@")[0]},
        capture_output=True,
    )
    # ... error handling
```

**Automated schedule**: Add cron-style backup via `apscheduler` or a simple background task:
```python
# In lifespan:
if os.getenv("BACKUP_CRON_ENABLED", "").lower() in ("1", "true"):
    from apscheduler.schedulers.asyncio import AsyncIOScheduler
    scheduler = AsyncIOScheduler()
    scheduler.add_job(container.backup_service.full_backup, 'cron', hour=2)
    scheduler.start()
```

---

## Phase 5: Security Hardening (Week 10-12)

### 5.1 Auth Middleware Fixes

1. **Rate-limit brute-force on API key validation**: Currently no protection against key enumeration.
   ```python
   # Add to RateLimitMiddleware — per-IP limit on 401 responses
   ```

2. **Admin session cookies**: Currently SHA-256 of `salt:username:password` — deterministic and never rotates.
   ```python
   # Add: session token with expiry, stored in-memory or DB
   # Add: SameSite=Strict, Secure flag, HttpOnly
   ```

3. **Telegram bot token exposure**: Bot token is in environment variables and config — ensure it never appears in logs or API responses.

### 5.2 Input Validation

- `routes.py:532-545`: Base64 payloads decoded and written to disk without content-type validation. Add image format verification.
- `exam_service.py`: Base64 images decoded to PIL without size limits on the decoded image dimensions.

### 5.3 Secrets Management

Current: All secrets in `.env` file and `config.yaml`.

Recommendation: For Oracle Cloud VPS deployment:
- Use Docker secrets or environment files with restricted permissions
- Never commit `.env` — ensure `.gitignore` covers all secret files
- Rotate `AUTH_HASH_SALT` requires re-hashing all API keys — document this procedure

---

## Phase 6: Scaling Preparation (Week 12+)

### 6.1 Redis Integration

Already stubbed in config (`redis.enabled`, `redis.url`, `redis.prefix`).

**Use cases**:
1. **Rate limiter state** — replace in-memory `RateLimiter` (lost on restart)
2. **Cache service** — replace in-memory `CacheService` (per-worker isolation)
3. **Telegram bot state** — replace `telegram_user_states.json`
4. **Session store** — replace deterministic admin cookies

### 6.2 Worker Offloading

**Current**: OCR (Tesseract) and ONNX inference run in-process via thread pools.

**Future**: When load exceeds single-server capacity:
```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│  FastAPI     │────▶│  Redis Queue │────▶│  OCR Worker     │
│  (API only)  │     │  (Bull/RQ)   │     │  (Tesseract)    │
└─────────────┘     └──────────────┘     ├─────────────────┤
                                          │  ONNX Worker    │
                                          │  (model.onnx)   │
                                          └─────────────────┘
```

This is NOT needed now — the current `SolverService` queue with 4 workers handles the load. Plan for it when p99 latency exceeds 2 seconds.

### 6.3 PostgreSQL Migration Path

1. Set `DB_TYPE=postgresql` and `DATABASE_URL` in environment
2. Run `alembic upgrade head` to create schema in PostgreSQL
3. Migrate data using the JSON export from `BackupService._export_json_backup()`
4. Verify with integration tests
5. Switch production config

---

## Implementation Sequence (Dependency Order)

```mermaid
graph TD
    P0[Phase 0: Test Harness + CI] --> P1[Phase 1: DB Unification]
    P0 --> P5A[Phase 5.1: Auth Fixes]
    P1 --> P2[Phase 2: Modular Monolith]
    P1 --> P4A[Phase 4.1: Docker Fixes]
    P2 --> P3[Phase 3: Frontend + Extension]
    P4A --> P4B[Phase 4.2: Telegram Isolation]
    P4A --> P4C[Phase 4.3: Backup Strategy]
    P2 --> P6A[Phase 6.1: Redis]
    P6A --> P6B[Phase 6.2: Worker Offloading]
    P1 --> P6C[Phase 6.3: PostgreSQL Migration]
```

**Critical path**: P0 → P1 → P2 (everything else can be parallelized)

---

## Risk Register

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| SQLite write contention between API + Telegram bot | Medium | High | WAL mode (already set), move to PostgreSQL |
| Data loss during DB unification | Low | Critical | Full backup before every migration step |
| Auth middleware regression | Medium | Critical | Phase 0 tests must cover all auth paths |
| Extension breaking change from backend refactor | Low | High | Extension talks to versioned `/v1/` API — don't change contract |
| Alembic migration conflict with inline DDL | Medium | Medium | Remove inline DDL AFTER Alembic baseline is proven |

---

## Files Changed Per Phase

### Phase 0 (New Files Only)
- `backend/tests/conftest.py` [NEW]
- `backend/tests/test_auth_middleware.py` [NEW]
- `backend/tests/test_exam_endpoint.py` [NEW]
- `backend/tests/test_admin_guard.py` [NEW]
- `.github/workflows/ci.yml` [NEW]

### Phase 1
- `backend/app/core/legacy_models.py` [NEW]
- `backend/app/core/repositories_v2/` [NEW — 8 files]
- `backend/app/core/database.py` [MODIFY — remove inline DDL]
- `backend/app/core/container.py` [MODIFY — guard create_all_tables]
- `backend/migrations/versions/` [NEW — baseline migration]
- `docker-entrypoint.sh` [MODIFY — add alembic upgrade]

### Phase 2
- `backend/app/modules/` [NEW — 6 module directories]
- `backend/app/api/routes.py` [MODIFY — thin to router includes]
- `backend/app/core/container.py` [MODIFY — module-based wiring]

### Phase 3
- `frontend/src/app/context/` [NEW — 2 context files]
- `frontend/src/app/App.jsx` [MODIFY — use contexts]
- `extension/package.json` [NEW — build validation]

### Phase 4
- `docker-compose.yml` [MODIFY — add PostgreSQL profile]
- `docker-compose.prod.yml` [NEW — production overrides]
- `docker-entrypoint.sh` [MODIFY — hardening]
- `backend/app/services/backup_service.py` [MODIFY — PostgreSQL support]

---

## Verification Plan

### Per-Phase Gates

| Phase | Gate Criteria |
|-------|--------------|
| P0 | All tests green, CI pipeline passes, Docker health check works |
| P1 | All existing functionality works with SQLAlchemy repos, Alembic migrations apply cleanly |
| P2 | No behavioral change — all API endpoints return identical responses |
| P3 | Frontend builds, all admin dashboard pages render correctly |
| P4 | `docker-compose up` starts cleanly, health checks pass, backup/restore works |
| P5 | Security audit checklist passes (auth, input validation, secrets) |
| P6 | Load test: 50 concurrent exam solves complete within 5 seconds |

### Regression Test Suite

After each phase, run:
1. `pytest backend/tests/ -v`
2. `docker build && docker run` health check
3. Manual: Login to admin dashboard, create key, solve captcha, solve exam question
4. Manual: Telegram bot `/start`, `/register`, `/my_status`

---

*This plan is designed for incremental, safe execution. Each phase produces a working system. No phase requires downtime except Phase 6.3 (PostgreSQL migration).*
