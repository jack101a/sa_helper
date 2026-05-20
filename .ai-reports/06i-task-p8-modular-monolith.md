# Task P8 — Modular Monolith (Route Decomposition)

> **Tasks**: T29, T30, T31  
> **Priority**: P8 (structural improvement — after core features)  
> **Depends on**: T1-T15 (features done first)  
> **Estimated changes**: ~200 lines new, ~100 lines modified

---

## Files to Read First

1. `backend/app/api/routes.py` — entire file (1058 lines)
2. `backend/app/api/admin.py` — entire file (31 lines, router composition)
3. `backend/app/core/container.py` — entire file (132 lines)
4. `backend/app/main.py` — lines 1-106 (routing includes)

---

## Current Problem

`routes.py` is **1058 lines** containing ALL v1 API endpoints:
- Captcha solve (`/v1/solve`) — lines ~80-200
- Exam solve + feedback (`/v1/exam/*`) — lines ~200-760
- Autofill (`/v1/autofill/*`, `/v1/field-mappings/*`, `/v1/locators`) — lines ~760-900
- Extension (`/v1/extension/*`) — lines ~900-1000
- Key management (`/v1/key/*`) — lines ~1000-1058

All of these share the same file, making it hard to maintain. The admin routes are already properly split (18 files in `admin_routes/`). We need to do the same for v1 routes.

---

## T29: Split routes.py into Module Route Files

### Goal

Decompose the 1058-line `routes.py` into focused route modules without changing ANY endpoint behavior.

### Step 29.1: Create module route directory

```
backend/app/api/v1_routes/
├── __init__.py
├── captcha.py        # /v1/solve
├── exam.py           # /v1/exam/solve, /v1/exam/feedback
├── autofill.py       # /v1/autofill/*, /v1/field-mappings/*, /v1/locators
├── extension.py      # /v1/extension/*
└── keys.py           # /v1/key/create, /v1/key/revoke
```

### Step 29.2: Extract captcha routes

**Create NEW file**: `backend/app/api/v1_routes/__init__.py`
```python
"""V1 API route modules."""
```

**Create NEW file**: `backend/app/api/v1_routes/captcha.py`

```python
"""Captcha solving endpoint — /v1/solve."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

logger = logging.getLogger(__name__)

router = APIRouter(tags=["captcha"])

# Move the /v1/solve endpoint handler from routes.py to here.
# Steps:
# 1. Read routes.py
# 2. Find the @router.post("/v1/solve") function
# 3. Copy the ENTIRE function (including all helper functions it uses)
# 4. Update imports as needed
# 5. Change route decorator from @router.post("/v1/solve") to @router.post("/solve")
#    because the /v1 prefix will be added by the parent router
```

> **CRITICAL rule for ALL route extractions:**
> - Do NOT change any function logic
> - Do NOT rename any functions
> - Do NOT change request/response formats
> - Only move code and adjust imports/route paths
> - Shared helper functions stay in `routes.py` or move to a shared utils file

### Step 29.3: Extract exam routes

**Create NEW file**: `backend/app/api/v1_routes/exam.py`

```python
"""Exam solving and feedback endpoints — /v1/exam/*."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/exam", tags=["exam"])

# Move these endpoints from routes.py:
# - POST /v1/exam/solve  → POST /solve
# - POST /v1/exam/feedback → POST /feedback
# - GET /v1/exam/stats → GET /stats  (if exists)
#
# Also move any exam-specific helper functions.
```

### Step 29.4: Extract autofill routes

**Create NEW file**: `backend/app/api/v1_routes/autofill.py`

```python
"""Autofill, field mappings, and locator endpoints."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

logger = logging.getLogger(__name__)

router = APIRouter(tags=["autofill"])

# Move these endpoints from routes.py:
# - /v1/autofill/* routes
# - /v1/field-mappings/* routes
# - /v1/locators
#
# Keep the route paths relative (prefix /v1 is added by parent)
```

### Step 29.5: Extract extension and key routes similarly

Create `extension.py` and `keys.py` following the same pattern.

### Step 29.6: Update routes.py to compose sub-routers

**File**: `backend/app/api/routes.py`

After extracting all endpoints, `routes.py` becomes a thin composition file:

```python
"""V1 API route composition."""

from __future__ import annotations

from fastapi import APIRouter

from app.api.v1_routes import captcha, exam, autofill, extension, keys

router = APIRouter(prefix="/v1")

router.include_router(captcha.router)
router.include_router(exam.router)
router.include_router(autofill.router)
router.include_router(extension.router)
router.include_router(keys.router)
```

> **IMPORTANT**: The original `routes.py` may have shared helpers (like `_b64_to_pil`, rate limiter instances, etc.). Move these to:
> - `backend/app/api/v1_routes/utils.py` for shared helpers
> - Or keep them in the original file if they're used by multiple modules

---

## T30: Create Service Module Boundaries

### Goal

Organize services into logical module directories (no code changes, just file reorganization).

### Current Structure
```
backend/app/services/
├── backup_service.py
├── cache_service.py
├── exam_service.py
├── exam_merge_service.py    # (created in T4)
├── extension_service.py
├── key_service.py
├── solver_service.py
├── subscription_service.py
├── telegram_bot.py
├── user_key_service.py
├── user_service.py
├── alert_service.py
├── audit_service.py
├── payment_service.py
└── usage_service.py
```

### Target Structure

**Do NOT move files.** Instead, add `__init__.py` boundary markers:

**Create NEW file**: `backend/app/services/__init__.py`
```python
"""
Service layer — organized by domain module.

Module boundaries:
- captcha: solver_service, cache_service
- exam: exam_service, exam_merge_service
- users: user_service, user_key_service, subscription_service, payment_service
- platform: key_service, backup_service, alert_service, audit_service, usage_service
- telegram: telegram_bot
- extension: extension_service
"""
```

> **Note**: This is documentation-only for now. Actual file moves happen in a future iteration when the team is ready for the disruption.

---

## T31: Update Container with Module Grouping

### Goal

Add logical grouping comments to `container.py` to make the module boundaries visible.

**File**: `backend/app/core/container.py`

**Add section comments** around the service field definitions. Do NOT change any code — just add comments:

```python
@dataclass
class Container:
    settings: Settings
    db: Database
    
    # ── Captcha Module ──
    solver_service: SolverService
    cache_service: CacheService
    
    # ── Exam Module ──
    exam_service: ExamService
    exam_merge_service: ExamMergeService
    
    # ── User Module ──
    user_service: UserService
    user_key_service: UserKeyService
    subscription_service: SubscriptionService
    payment_service: PaymentService
    
    # ── Platform Module ──
    key_service: KeyService
    backup_service: BackupService
    alert_service: AlertService
    audit_service: AuditService
    usage_service: UsageService
    
    # ── Extension Module ──
    extension_service: ExtensionService
```

> **Important**: Read `container.py` to see the actual fields and their names. Adjust the grouping above to match the real field names. Only add comments — do NOT reorder fields or change any code.

---

## Verification

```bash
# 1. All imports work
cd backend && python -c "from app.api.routes import router; print('routes OK')"
cd backend && python -c "from app.api.v1_routes.captcha import router; print('captcha OK')"
cd backend && python -c "from app.api.v1_routes.exam import router; print('exam OK')"

# 2. All endpoints still exist (count should match before/after)
cd backend && python -c "
from app.api.routes import router
print(f'Total v1 routes: {len(router.routes)}')
for r in router.routes:
    if hasattr(r, 'path'):
        print(f'  {r.methods} {r.path}')
"

# 3. Run existing tests
cd backend && python -m pytest tests/ -v
```

---

## Summary of Changes

| File | Change |
|------|--------|
| `backend/app/api/v1_routes/__init__.py` | [NEW] Package marker |
| `backend/app/api/v1_routes/captcha.py` | [NEW] Captcha solve route |
| `backend/app/api/v1_routes/exam.py` | [NEW] Exam solve + feedback routes |
| `backend/app/api/v1_routes/autofill.py` | [NEW] Autofill + mappings + locators |
| `backend/app/api/v1_routes/extension.py` | [NEW] Extension routes |
| `backend/app/api/v1_routes/keys.py` | [NEW] Key management routes |
| `backend/app/api/v1_routes/utils.py` | [NEW] Shared helpers |
| `backend/app/api/routes.py` | MODIFY — thin to router includes |
| `backend/app/services/__init__.py` | [NEW] Module boundary docs |
| `backend/app/core/container.py` | +comments only — module grouping |
