# Task P6 — Database Unification (Inline DDL → Alembic)

> **Tasks**: T23, T24, T25  
> **Priority**: P6 (highest risk — do AFTER tests exist from P4)  
> **Depends on**: T16-T19 (tests must be green first)  
> **Estimated changes**: ~60 lines modified, ~200 lines new migration

---

## Files to Read First

1. `backend/app/core/database.py` — lines 100-437 (the inline DDL in `init()`)
2. `backend/app/core/db.py` — lines 60-111 (`create_all_tables()`)
3. `backend/app/core/container.py` — lines 69-71 (`create_all_tables()` call)
4. `backend/app/core/models.py` — all ORM models (392 lines)
5. `backend/migrations/env.py` — Alembic env configuration
6. `backend/migrations/versions/` — list existing migrations

---

## CRITICAL WARNING

> This is the **highest risk task**. The `database.py:init()` method creates/alters 18+ tables.  
> Removing it without a proper Alembic migration will **break the app on fresh installs**.  
> 
> **Rule**: Do NOT delete any inline DDL until the Alembic migration is proven to create the same schema.

---

## T23: Guard `create_all_tables()` Behind Debug Flag

### Goal

Prevent `create_all_tables()` from running in production — it bypasses Alembic.

**File**: `backend/app/core/container.py`  
**Location**: Around lines 69-71

**Find this block:**
```python
    # Create tables if they don't exist (dev convenience; production uses migrations)
    from app.core.db import create_all_tables
    create_all_tables()
```

**Replace with:**
```python
    # Create ORM tables (dev only — production uses Alembic migrations)
    if settings.server.debug:
        from app.core.db import create_all_tables
        create_all_tables()
```

> **Check**: Read `container.py` to find the exact location. The comment text may differ slightly. Search for `create_all_tables`.

---

## T24: Create Comprehensive Alembic Baseline Migration

### Goal

Generate a single Alembic migration that creates ALL tables (both legacy SQLite and ORM), so that `alembic upgrade head` on a fresh database creates a working schema.

### Step 24.1: Check existing migrations

```bash
cd backend && ls migrations/versions/
```

Read each existing migration file. Note their revision IDs and what tables they create.

### Step 24.2: Create the baseline migration

**Create NEW file**: `backend/migrations/versions/0002_full_schema_baseline.py`

> **Note**: The actual filename must follow Alembic naming convention. Use the pattern from existing migration files.

```python
"""Full schema baseline — creates all legacy + ORM tables.

This migration ensures a fresh database has the complete schema.
Tables use CREATE TABLE IF NOT EXISTS to be safe on existing databases.

Revision ID: 0002_full_schema
Revises: (read the head revision from existing migrations)
Create Date: 2026-05-19
"""
from alembic import op
import sqlalchemy as sa

# IMPORTANT: Set 'revision' and 'down_revision' by reading existing migrations
revision = '0002_full_schema'
down_revision = None  # SET THIS by reading the latest existing migration's revision ID
branch_labels = None
depends_on = None


def upgrade():
    """Create all tables that database.py:init() currently creates inline."""
    
    # ── Legacy tables (from database.py:init()) ──
    
    op.execute("""
    CREATE TABLE IF NOT EXISTS api_keys (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        key_hash TEXT NOT NULL UNIQUE,
        enabled INTEGER NOT NULL DEFAULT 1,
        all_domains INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        expires_at TEXT,
        revoked_at TEXT,
        key_type TEXT NOT NULL DEFAULT 'user'
    )
    """)
    
    op.execute("""
    CREATE TABLE IF NOT EXISTS api_key_allowed_domains (
        key_id INTEGER NOT NULL,
        domain TEXT NOT NULL,
        PRIMARY KEY (key_id, domain),
        FOREIGN KEY(key_id) REFERENCES api_keys(id)
    )
    """)
    
    op.execute("""
    CREATE TABLE IF NOT EXISTS api_key_rate_limits (
        key_id INTEGER PRIMARY KEY,
        requests_per_minute INTEGER NOT NULL,
        burst INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY(key_id) REFERENCES api_keys(id)
    )
    """)
    
    op.execute("""
    CREATE TABLE IF NOT EXISTS api_key_device_bindings (
        key_id INTEGER PRIMARY KEY,
        device_id TEXT NOT NULL,
        user_agent TEXT,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        FOREIGN KEY(key_id) REFERENCES api_keys(id)
    )
    """)
    
    op.execute("""
    CREATE TABLE IF NOT EXISTS usage_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key_id INTEGER NOT NULL,
        domain TEXT,
        event_type TEXT NOT NULL DEFAULT 'solve',
        created_at TEXT NOT NULL,
        device_id TEXT,
        processing_ms INTEGER,
        FOREIGN KEY(key_id) REFERENCES api_keys(id)
    )
    """)
    
    op.execute("""
    CREATE TABLE IF NOT EXISTS model_routes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        label TEXT NOT NULL UNIQUE,
        model_path TEXT NOT NULL,
        device TEXT NOT NULL DEFAULT 'cpu',
        is_default INTEGER NOT NULL DEFAULT 0,
        enabled INTEGER NOT NULL DEFAULT 1
    )
    """)
    
    op.execute("""
    CREATE TABLE IF NOT EXISTS domain_model_mappings (
        domain TEXT PRIMARY KEY,
        model_id INTEGER NOT NULL,
        FOREIGN KEY(model_id) REFERENCES model_routes(id)
    )
    """)
    
    op.execute("""
    CREATE TABLE IF NOT EXISTS platform_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL DEFAULT '',
        updated_at TEXT
    )
    """)
    
    op.execute("""
    CREATE TABLE IF NOT EXISTS api_key_entitlements (
        key_id INTEGER PRIMARY KEY,
        services TEXT NOT NULL DEFAULT '{}',
        notes TEXT NOT NULL DEFAULT '',
        FOREIGN KEY(key_id) REFERENCES api_keys(id)
    )
    """)
    
    op.execute("""
    CREATE TABLE IF NOT EXISTS exam_learned (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        question_hash TEXT NOT NULL UNIQUE,
        question_phash TEXT NOT NULL DEFAULT '',
        question_text TEXT NOT NULL DEFAULT '',
        option_1 TEXT NOT NULL DEFAULT '',
        option_2 TEXT NOT NULL DEFAULT '',
        option_3 TEXT NOT NULL DEFAULT '',
        option_4 TEXT NOT NULL DEFAULT '',
        correct_option INTEGER NOT NULL,
        correct_option_hash TEXT NOT NULL DEFAULT '',
        correct_option_phash TEXT NOT NULL DEFAULT '',
        correct_option_text TEXT NOT NULL DEFAULT '',
        confidence REAL NOT NULL DEFAULT 0.8,
        seen_count INTEGER NOT NULL DEFAULT 1,
        verified_count INTEGER NOT NULL DEFAULT 0,
        wrong_count INTEGER NOT NULL DEFAULT 0,
        first_seen TEXT NOT NULL,
        last_seen TEXT NOT NULL,
        last_verified_at TEXT,
        source TEXT NOT NULL DEFAULT 'exam_feedback',
        learning_mode TEXT NOT NULL DEFAULT 'hash_based',
        ocr_quality TEXT NOT NULL DEFAULT 'unverified',
        ocr_preview_unreliable INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'training'
    )
    """)
    
    op.execute("""
    CREATE TABLE IF NOT EXISTS autofill_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        domain TEXT NOT NULL,
        field_selector TEXT NOT NULL,
        field_name TEXT NOT NULL DEFAULT '',
        field_value TEXT NOT NULL DEFAULT '',
        rule_type TEXT NOT NULL DEFAULT 'fill',
        priority INTEGER NOT NULL DEFAULT 0,
        enabled INTEGER NOT NULL DEFAULT 1,
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT,
        updated_at TEXT
    )
    """)
    
    op.execute("""
    CREATE TABLE IF NOT EXISTS locator_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        domain TEXT NOT NULL,
        element_name TEXT NOT NULL,
        selector TEXT NOT NULL,
        selector_type TEXT NOT NULL DEFAULT 'css',
        enabled INTEGER NOT NULL DEFAULT 1,
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT,
        updated_at TEXT
    )
    """)
    
    op.execute("""
    CREATE TABLE IF NOT EXISTS automation_methods (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        method_name TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        is_active INTEGER NOT NULL DEFAULT 0,
        config TEXT NOT NULL DEFAULT '{}',
        created_at TEXT,
        updated_at TEXT
    )
    """)
    
    op.execute("""
    CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        actor_type TEXT NOT NULL DEFAULT 'system',
        actor_id TEXT,
        action TEXT NOT NULL,
        target_type TEXT,
        target_id TEXT,
        before_json TEXT,
        after_json TEXT,
        created_at TEXT NOT NULL
    )
    """)
    
    # ── ORM tables are handled by SQLAlchemy models ──
    # (users, subscription_plans, user_subscriptions, payment_records,
    #  user_api_keys, user_api_key_devices, usage_cycles)
    # These are created by the ORM via metadata.create_all() or existing migrations.
    # Do NOT duplicate them here.
    
    # ── Indexes ──
    op.execute("CREATE INDEX IF NOT EXISTS idx_usage_events_key_id ON usage_events(key_id)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_usage_events_created ON usage_events(created_at)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_exam_learned_hash ON exam_learned(question_hash)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_exam_learned_status ON exam_learned(status)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at)")


def downgrade():
    """Drop all legacy tables. WARNING: destructive."""
    for table in [
        "audit_log", "automation_methods", "locator_rules", "autofill_rules",
        "exam_learned", "api_key_entitlements", "platform_settings",
        "domain_model_mappings", "model_routes", "usage_events",
        "api_key_device_bindings", "api_key_rate_limits",
        "api_key_allowed_domains", "api_keys",
    ]:
        op.execute(f"DROP TABLE IF EXISTS {table}")
```

> **CRITICAL**: Before writing this file:
> 1. Read ALL existing migration files in `backend/migrations/versions/`
> 2. Set `down_revision` to the latest existing migration's revision ID
> 3. Compare the DDL above against `database.py:init()` lines 100-437 — they MUST match
> 4. Check for any ALTER TABLE statements in `database.py` that add columns — include those columns in the CREATE TABLE

---

## T25: Remove Inline DDL from database.py (AFTER migration is proven)

### Goal

After T24 migration is tested, remove the inline DDL from `database.py:init()`.

### Step 25.1: Verify migration works

```bash
# Create fresh test DB
rm -f /tmp/test_migration.db
cd backend && SQLITE_PATH=/tmp/test_migration.db python -m alembic upgrade head
# Check tables exist
sqlite3 /tmp/test_migration.db ".tables"
```

### Step 25.2: Slim down database.py init()

**File**: `backend/app/core/database.py`  
**Location**: `init()` method (line 100-437)

**Replace the entire init() method body** with:

```python
    def init(self) -> None:
        """Initialize database connection. Schema is managed by Alembic migrations."""
        with self._lock:
            with self.connect() as conn:
                # Verify critical tables exist
                tables = [row[0] for row in conn.execute(
                    "SELECT name FROM sqlite_master WHERE type='table'"
                ).fetchall()]
                
                required = {"api_keys", "exam_learned", "platform_settings", "model_routes"}
                missing = required - set(tables)
                if missing:
                    logger.warning(
                        "missing_tables — run 'alembic upgrade head'",
                        extra={"context": {"missing": list(missing)}},
                    )
                    # Fallback: create tables inline (for dev/first-run without Alembic)
                    self._create_tables_fallback(conn)
```

**Then move the original `init()` DDL code** into a private `_create_tables_fallback()` method:

```python
    def _create_tables_fallback(self, conn) -> None:
        """Fallback table creation for dev environments without Alembic."""
        conn.executescript("""
            ... (keep all the existing CREATE TABLE and ALTER TABLE statements)
        """)
```

> **Important**: Do NOT delete the inline DDL yet. Move it to `_create_tables_fallback()` as a safety net. Only delete it after the Alembic migration has been deployed and verified in production.

---

## Verification

```bash
# 1. Fresh DB with Alembic
rm -f /tmp/test_alembic.db
cd backend && SQLITE_PATH=/tmp/test_alembic.db python -m alembic upgrade head
sqlite3 /tmp/test_alembic.db ".tables" | tr ' ' '\n' | sort

# 2. Compare with init() fallback
rm -f /tmp/test_init.db  
cd backend && python -c "
import os; os.environ['SQLITE_PATH'] = '/tmp/test_init.db'
from app.core.database import Database
db = Database('/tmp/test_init.db')
db.init()
" 
sqlite3 /tmp/test_init.db ".tables" | tr ' ' '\n' | sort

# 3. Both outputs should show the same tables

# 4. Run tests
cd backend && python -m pytest tests/ -v
```

---

## Summary of Changes

| File | Change |
|------|--------|
| `container.py` | ~2 lines — guard `create_all_tables()` behind debug |
| `migrations/versions/0002_...py` | [NEW] ~200 lines — full schema baseline |
| `database.py` | ~50 lines — refactor `init()` to use fallback pattern |
