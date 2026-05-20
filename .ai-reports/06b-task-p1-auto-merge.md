# Task P1 — Auto-Merge Service

> **Tasks**: T4, T5, T6  
> **Priority**: P1 (after P0 is done)  
> **Depends on**: T1-T3 (in-memory index must exist)  
> **Estimated changes**: ~150 lines new, ~20 lines modified

---

## Files to Read First

1. `backend/app/services/exam_service.py` — lines 159-230 (init, data loading)
2. `backend/app/core/repositories/exam_learned.py` — lines 303-340 (`export_to_json`)
3. `backend/app/core/container.py` — entire file (132 lines)
4. `backend/app/main.py` — entire file (106 lines)
5. `backend/app/api/admin_routes/system.py` — entire file

---

## T4: Create ExamMergeService

### Goal

Create a service that merges verified learned questions into `questions.json` and hot-reloads ExamService's in-memory question list.

### Step 4.1: Create the service file

**Create NEW file**: `backend/app/services/exam_merge_service.py`

```python
"""Auto-merge verified learned questions into the main question bank.

When exam_learned entries reach 'verified' status (confidence >= 0.95,
verified_count >= 10, wrong_count == 0), this service merges them into
questions.json so they become part of the permanent question bank.

The merge is idempotent — duplicate question_hashes are skipped.
"""

from __future__ import annotations

import json
import logging
import shutil
import threading
import time
from pathlib import Path
from typing import Any, TYPE_CHECKING

if TYPE_CHECKING:
    from app.core.database import Database
    from app.services.exam_service import ExamService

logger = logging.getLogger(__name__)


class ExamMergeService:
    """Merges verified exam_learned entries into questions.json."""

    def __init__(self, db: "Database", data_dir: Path, exam_service: "ExamService") -> None:
        self._db = db
        self._data_dir = data_dir
        self._exam_service = exam_service
        self._merge_lock = threading.Lock()
        self._questions_path = data_dir / "questions" / "questions.json"

    def merge_verified_to_main(self) -> dict[str, Any]:
        """
        Merge verified learned questions into questions.json.

        Steps:
        1. Load current questions.json from memory (ExamService._questions)
        2. Get verified entries from exam_learned DB
        3. Skip entries whose question_hash already exists in the main bank
        4. Append new entries
        5. Backup old questions.json
        6. Write merged questions.json to disk
        7. Update ExamService._questions in memory (hot reload)
        8. Reload the learned index

        Returns:
            {
                "merged": int,           # new entries added
                "skipped_duplicates": int,
                "total_bank": int,       # total questions after merge
                "backup_path": str,      # path to backup file
            }
        """
        with self._merge_lock:
            # 1. Get current question bank from memory
            current_questions = list(self._exam_service._questions)

            # 2. Build set of existing question hashes for dedup
            existing_hashes: set[str] = set()
            for entry in current_questions:
                # questions.json entries may have _question_hash or _hash
                h = (
                    entry.get("_question_hash")
                    or entry.get("_hash")
                    or entry.get("question_hash")
                    or ""
                )
                if h:
                    existing_hashes.add(h)

            # 3. Get verified learned entries (exported in questions.json format)
            verified = self._db.exam_learned.export_to_json()

            # 4. Merge, skipping duplicates
            merged_count = 0
            skipped = 0
            for learned_entry in verified:
                q_hash = learned_entry.get("_question_hash", "")
                if not q_hash:
                    q_hash = learned_entry.get("_hash", "")
                if q_hash in existing_hashes:
                    skipped += 1
                    continue
                current_questions.append(learned_entry)
                existing_hashes.add(q_hash)
                merged_count += 1

            backup_path = ""
            if merged_count > 0:
                # 5. Backup old questions.json
                backup_path = self._backup_questions_json()

                # 6. Write merged questions.json to disk
                self._questions_path.parent.mkdir(parents=True, exist_ok=True)
                tmp_path = self._questions_path.with_suffix(".tmp")
                with tmp_path.open("w", encoding="utf-8") as f:
                    json.dump(current_questions, f, ensure_ascii=False, indent=2)
                tmp_path.replace(self._questions_path)

                # 7. Hot-reload ExamService question bank
                self._exam_service._questions = current_questions

                # 8. Reload learned index
                self._exam_service._reload_learned_index()

                logger.info("exam_merge_completed", extra={"context": {
                    "merged": merged_count,
                    "skipped": skipped,
                    "total": len(current_questions),
                }})
            else:
                logger.info("exam_merge_nothing_new", extra={"context": {
                    "skipped": skipped,
                    "total": len(current_questions),
                }})

            return {
                "merged": merged_count,
                "skipped_duplicates": skipped,
                "total_bank": len(current_questions),
                "backup_path": backup_path,
            }

    def _backup_questions_json(self) -> str:
        """Create a timestamped backup of questions.json. Keep last 5."""
        if not self._questions_path.exists():
            return ""
        backup_dir = self._questions_path.parent
        timestamp = int(time.time())
        backup_name = f"questions.backup_{timestamp}.json"
        backup_path = backup_dir / backup_name
        shutil.copy2(self._questions_path, backup_path)

        # Prune old backups — keep last 5
        backups = sorted(
            backup_dir.glob("questions.backup_*.json"),
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )
        for stale in backups[5:]:
            try:
                stale.unlink(missing_ok=True)
            except Exception:
                pass

        return str(backup_path)

    def get_merge_stats(self) -> dict[str, Any]:
        """Return stats about the training pipeline for admin dashboard."""
        learned_stats = self._db.exam_learned.get_stats()
        return {
            "main_bank_count": len(self._exam_service._questions),
            "learned_total": learned_stats.get("total_learned", 0),
            "learned_verified": learned_stats.get("high_confidence", 0),
            "learned_avg_confidence": learned_stats.get("avg_confidence", 0.0),
            "learned_total_confirmations": learned_stats.get("total_confirmations", 0),
            "inmemory_hash_count": len(self._exam_service._learned_by_hash),
            "inmemory_phash_count": len(self._exam_service._learned_by_phash),
        }
```

### Step 4.2: Wire ExamMergeService in Container

**File**: `backend/app/core/container.py`  
**Read the file first** to understand the current structure.

**Add import** near the top imports:
```python
from app.services.exam_merge_service import ExamMergeService
```

**Add field** to the `Container` dataclass (after `exam_service` field):
```python
    exam_merge_service: ExamMergeService
```

**Add initialization** in `create_container()` or wherever `exam_service` is created:
```python
    exam_merge_service = ExamMergeService(
        db=db,
        data_dir=data_dir,
        exam_service=exam_service,
    )
```

**Pass it** to the Container constructor.

> **Important**: Read `container.py` carefully to understand the exact pattern used for other services, and follow the same pattern.

---

## T5: Add Merge Scheduler as Background Task

### Goal

Run auto-merge every N hours (configurable via `exam.merge_interval_hours` setting).

**File**: `backend/app/main.py`  
**Location**: Inside the `lifespan()` function, where other background tasks are started.

**Add this function** before the lifespan function:

```python
async def _exam_merge_loop(container) -> None:
    """Auto-merge verified learned questions into main bank on schedule."""
    while True:
        try:
            interval_hours = 6
            try:
                interval_hours = max(1, int(container.db.get_setting("exam.merge_interval_hours", "6")))
            except (ValueError, TypeError):
                pass

            merge_enabled = container.db.get_setting(
                "exam.auto_merge_enabled", "true"
            ).lower() in ("true", "1", "yes", "on")

            if not merge_enabled:
                await asyncio.sleep(3600)  # check again in 1 hour
                continue

            await asyncio.sleep(interval_hours * 3600)

            result = container.exam_merge_service.merge_verified_to_main()
            if result["merged"] > 0:
                logger.info("exam_auto_merge", extra={"context": result})
                # Send alert if alert_service exists
                try:
                    container.alert_service.send(
                        f"📚 MCQ Bank Merge: {result['merged']} new questions merged "
                        f"(total: {result['total_bank']})"
                    )
                except Exception:
                    pass
        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.error("exam_auto_merge_failed", extra={"context": {"error": str(e)}})
            await asyncio.sleep(3600)  # retry in 1 hour on failure
```

**Inside the lifespan function**, where other background tasks are started (look for patterns like `asyncio.create_task`), add:

```python
    merge_task = asyncio.create_task(_exam_merge_loop(container))
```

**And in the shutdown section** (after `yield`):

```python
    merge_task.cancel()
```

> **Important**: Read `main.py` carefully. Match the exact pattern used for existing background tasks (solver, telegram, etc.).

---

## T6: Add Admin Merge Endpoint and Settings

### Goal

Let admin trigger merge manually and see training stats.

### Step 6.1: Add merge endpoint

**File**: `backend/app/api/admin_routes/system.py`  
**Read the file first.**

**Add these endpoints** following the existing pattern in the file:

```python
@router.post("/api/exam/merge")
async def force_exam_merge(request: Request) -> Any:
    """Manually trigger merge of verified learned questions into main bank."""
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    try:
        result = container.exam_merge_service.merge_verified_to_main()
        return JSONResponse(result)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@router.get("/api/exam/training-stats")
async def exam_training_stats(request: Request) -> Any:
    """Return training pipeline statistics for admin dashboard."""
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    try:
        stats = container.exam_merge_service.get_merge_stats()
        return JSONResponse(stats)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)
```

**Make sure to import** `_admin_guard` and `JSONResponse` at the top — check existing imports in the file.

### Step 6.2: Add default settings

The following settings should be available via the admin settings panel. They are read dynamically using `db.get_setting()` — no schema change needed, just document them:

| Key | Default | Description |
|-----|---------|-------------|
| `exam.merge_interval_hours` | `6` | Hours between auto-merges |
| `exam.auto_merge_enabled` | `true` | Enable/disable auto-merge |
| `exam.learning_enabled` | `true` | Enable/disable learning (already exists) |
| `exam.learning_mode` | `train_only` | `train_only` or `auto_click` (already exists) |
| `exam.learn_min_confidence` | `0.95` | Min confidence for verified status (already exists) |
| `exam.learn_min_confirmations` | `10` | Min verified count (already exists) |

These already work via the existing `platform_settings` table — no new tables or columns needed.

---

## Verification

### 1. Import check
```bash
cd backend && python -c "from app.services.exam_merge_service import ExamMergeService; print('OK')"
```

### 2. Container wiring check
```bash
cd backend && python -c "
from app.core.container import Container
print('container fields:', [f for f in dir(Container) if 'merge' in f.lower()])
"
```

### 3. Admin endpoint check
```bash
cd backend && python -c "from app.api.admin_routes.system import router; print('routes:', [r.path for r in router.routes])"
```

---

## Summary of Changes

| File | Change |
|------|--------|
| `backend/app/services/exam_merge_service.py` | [NEW] ~130 lines — merge service |
| `backend/app/core/container.py` | +~5 lines — wire ExamMergeService |
| `backend/app/main.py` | +~35 lines — merge scheduler background task |
| `backend/app/api/admin_routes/system.py` | +~25 lines — 2 new admin endpoints |
