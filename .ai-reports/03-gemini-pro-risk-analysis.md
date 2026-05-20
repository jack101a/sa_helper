# Deep Technical Risk Analysis — sa_helper Backend

> **Target Area:** Backend logic, API flow, auth, database, security, and side effects.
> **Date:** 2026-05-19

Based on the architectural reports and deep codebase inspection, this report details the concrete technical risks present in the `sa_helper` backend.

## 1. Security-Sensitive Files
*   **`backend/app/middleware/auth_middleware.py`**: The central auth entrypoint. Currently orchestrating a dangerous fallback mechanism between two parallel data sources.
*   **`backend/app/core/database.py`**: Handles direct raw SQL injection and arbitrary schema changes on application boot.
*   **`backend/app/services/telegram_bot.py`**: Directly processes user interactions, authentication states, and payment proofs.
*   **`backend/app/api/routes.py`**: Validates the `x-admin-token` dynamically within methods, making it prone to bypass if not applied correctly across all admin-sensitive endpoints.

## 2. Auth/Session Risks
*   **Dangerous Dual-Auth Fallback (CRITICAL):**
    In `auth_middleware.py` (`_try_user_key`), the new SQLAlchemy user-key validation is wrapped in a blanket `except Exception as e: return None`. If the new database is unavailable, misconfigured, or throws a timeout, the system silently falls back to the legacy SQLite database via `KeyService`. A user who is blocked or revoked in the new system can bypass authorization if their key remains active in the legacy fallback.
*   **Admin Dashboard Unbounded Login:**
    The admin login endpoint (`backend/app/api/admin_routes/auth.py`) lacks rate limiting, leaving it vulnerable to brute-force password attacks against the admin credentials.

## 3. Database/Data Consistency Risks
*   **No Transactional DDL/Migrations (CRITICAL):**
    `backend/app/core/database.py` (`init()`) executes 250+ lines of inline `CREATE TABLE` and `ALTER TABLE` PRAGMA checks on every boot. There is no transaction wrapper. If a column rename or table creation fails halfway, the database schema remains partially updated permanently, leading to application crashes.
*   **In-Memory Telegram State Corruption:**
    `backend/app/services/telegram_bot.py` (`_save_states()`) writes directly to `telegram_user_states.json` without file locking or atomic writes (like `rename()`). If the bot restarts or crashes mid-write, the JSON file becomes malformed, and upon restart, the naked `except Exception` handler in `_load_states()` silently drops all user sessions.
*   **Parallel Database State:**
    The system runs both `database.py` (legacy SQLite) and `db.py` (SQLAlchemy). Shared concepts (like `api_keys` vs `user_api_keys`) risk severe data drift.

## 4. API Validation Risks
*   **In-Memory Rate Limiting Leaks:**
    `backend/app/api/routes.py` manages a global dictionary `_report_buckets` for report rate limiting. It relies on a `_prune_report_buckets()` function invoked lazily on incoming requests. In low-traffic scenarios or uneven request distributions, this memory structure can grow unbounded.
*   **Bypassing Service Layer Validations:**
    `backend/app/api/admin_routes/analytics.py` (`_collect_datasets_files`) directly accesses disk files and bypasses traditional service-level file validation, creating path traversal risks if not strictly sanitized.

## 5. Error Handling Gaps
*   **Blanket Exception Catching:**
    A massive anti-pattern of `except Exception as e:` exists throughout the codebase (over 100 occurrences). This swallows legitimate `KeyError`, `AttributeError`, and database `OperationalError`, translating them into opaque 500 errors while leaving the system in an inconsistent state. Notable examples: `api/routes.py`, `auth_middleware.py`, and `telegram_bot.py`.
*   **Silent Dependency Failures:**
    `backend/app/services/exam_service.py` detects Tesseract presence at import time. If Tesseract is missing, it logs a warning but continues. Subsequent OCR calls will silently return empty text instead of explicitly failing.

## 6. Background Jobs, Queues, Cron, or Async Side Effects
*   **Volatile In-Memory Solver Queue:**
    `backend/app/services/solver_service.py` uses an `asyncio.Queue` for OCR jobs. Pending jobs have no persistence. On server shutdown (`SIGTERM`), it loops through pending jobs and forcefully injects `RuntimeError("Server shutting down")`, causing the HTTP caller to receive an unhandled 500 instead of a graceful 503 retry signal. On unexpected crashes (`SIGKILL`), all pending jobs are silently lost.
*   **Implicit Multiprocessing State Collision:**
    The Telegram bot (`telegram_bot.py`) is started from within FastAPI lifespan if `START_TELEGRAM_BOT_IN_API` is set. If Uvicorn is launched with multiple workers, multiple bots will boot, fight for the Telegram long-polling connection, and overwrite each other's `telegram_user_states.json`.

## 7. External Service/Integration Risks
*   **LiteLLM Unhandled Timeouts:**
    `exam_service.py` orchestrates direct HTTP calls to LiteLLM. There's no clear evidence of robust circuit-breaking or timeout fallbacks. If the external LLM provider stalls, the internal FastAPI worker pool will exhaust its connections waiting for responses.

## 8. Files That Should NOT Be Refactored Casually
*   **`backend/app/api/routes.py`**: It mixes routing, auth, file I/O, JavaScript generation, and domain logic. Extracting components here requires rigorous end-to-end integration tests (which currently do not exist).
*   **`backend/app/core/database.py`**: The god-facade. 80+ proxy methods depend on its exact signature.
*   **`backend/app/services/telegram_bot.py`**: Modifying its state machine without introducing a proper database lock or Redis backend risks breaking existing multi-step user payment flows.

## 9. Hidden Dependencies
*   **Tesseract System Binary (`tesseract`)**: Not explicitly managed by Python `requirements.txt`; relies heavily on Docker/OS-level installation.
*   **Nginx Routing Catch-all:** The SPA frontend `admin_routes/analytics.py` implements a wildcard `{full_path:path}` catch-all that can hide 404s or interfere with new API endpoints if routing order changes.

## 10. Safe Migration Order
To resolve these risks safely, the following sequence is strictly recommended:
1.  **Test Coverage (Mandatory First Step):** Implement E2E tests for the core `v1` API and auth middleware. (Current test coverage is essentially 0%).
2.  **Fix Auth Middleware:** Remove the `except Exception` fallback in `auth_middleware.py`. Make the failure path explicit.
3.  **Consolidate Database:** Unify `database.py` and `db.py`. Move all DDL/migrations to Alembic exclusively. Remove `database.py`'s `init()` method entirely.
4.  **Extract State:** Migrate `telegram_user_states.json` to the SQLAlchemy database using pessimistic row locking.
5.  **Refactor Routes:** Extract domain logic from `routes.py` into distinct `services` (e.g., `automation_service.py`, `rate_limit_service.py`).

## 11. Test Coverage Gaps for Risky Areas
*   **Auth Middleware:** No tests covering the dual-auth fallback or device binding logic.
*   **Database Migrations:** No tests verifying data integrity after `database.py` DDL execution.
*   **Telegram State Machine:** No tests for asynchronous state transitions or concurrent file writes.
*   **Solver Queue:** No tests for queue eviction, cache hits, or shutdown handling.

## 12. Recommended Rollback Strategy
*   **Deployments:** Ensure database backups (both SQLite and SQLAlchemy PostgreSQL representations if used) are taken *immediately* before any startup.
*   **Application Level:** Because migrations are currently inline and un-versioned (`database.py`), rolling back requires restoring the `.db` file from a snapshot. Code rollbacks *will not* downgrade schema changes, causing instant incompatibilities if an older code version runs against a newer schema.

## 13. Areas Where Evidence is Weak and Needs Human/Opus Inspection
*   **Payment Service Integrity:** `backend/app/services/payment_service.py` was not fully analyzed for transaction isolation. Does it prevent double-crediting if a user submits the same receipt twice concurrently?
*   **UserKeyService Entitlements:** How does `UserKeyService` precisely map `services_json` entitlements from the legacy SQLite system into the new SQLAlchemy schema without data loss?
*   **Memory Leaks in Background Tasks:** Deep profiling is needed to confirm if the `asyncio` tasks spawned by the `solver_service` or `telegram_bot` gracefully release memory over long uptimes.