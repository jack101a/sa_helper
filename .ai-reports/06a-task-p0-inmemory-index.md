# Task P0 — In-Memory Learned Hash Index

> **Tasks**: T1, T2, T3  
> **Priority**: P0 (do first)  
> **Estimated changes**: ~80 lines modified, 0 new files

---

## Files to Read First

Before writing any code, read these files completely:

1. `backend/app/services/exam_service.py` — lines 159-230 (init), lines 618-841 (solve)
2. `backend/app/core/repositories/exam_learned.py` — entire file (340 lines)
3. `backend/app/api/routes.py` — lines 618-757 (exam_feedback endpoint)

---

## T1: Add In-Memory Hash Index to ExamService

### Goal

Replace the 4 slow SQL queries in `solve()` with in-memory dict lookups. The sign hash system already works this way (`self._sign_hashes` dict) — we do the same for learned questions.

### Step 1.1: Add index fields and reload method

**File**: `backend/app/services/exam_service.py`  
**Location**: Inside `ExamService.__init__()`, after line 228 (`self._ocr_pool = ...`)

**Add these lines at the end of `__init__`:**

```python
        # In-memory learned question index (replaces SQL queries in solve)
        # Keyed by question_hash and question_phash for O(1) and O(n) lookup
        self._learned_by_hash: dict[str, dict] = {}
        self._learned_by_phash: dict[str, dict] = {}
        self._reload_learned_index()
```

**Add this new method** after the `close()` method (after line 232):

```python
    def _reload_learned_index(self) -> None:
        """Load all non-rejected learned questions into memory for fast solve lookup."""
        try:
            rows = self._db.exam_learned.get_all_learned(min_confidence=0.0)
            by_hash: dict[str, dict] = {}
            by_phash: dict[str, dict] = {}
            for row in rows:
                if row.get("status") == "rejected":
                    continue
                h = row.get("question_hash", "")
                p = row.get("question_phash", "")
                if h:
                    by_hash[h] = row
                if p:
                    by_phash[p] = row
            self._learned_by_hash = by_hash
            self._learned_by_phash = by_phash
            logger.info("learned_index_loaded", extra={"context": {
                "hash_count": len(by_hash),
                "phash_count": len(by_phash),
            }})
        except Exception as e:
            logger.error("learned_index_load_failed", extra={"context": {"error": str(e)}})

    def _inmemory_get_by_hash(
        self,
        question_hash: str,
        min_confidence: float,
        min_verified: int,
    ) -> dict | None:
        """In-memory equivalent of exam_learned.get_by_hash()."""
        item = self._learned_by_hash.get(question_hash)
        if not item:
            return None
        if (
            item.get("status") == "verified"
            and float(item.get("confidence") or 0) >= min_confidence
            and int(item.get("verified_count") or 0) >= min_verified
            and int(item.get("wrong_count") or 0) == 0
        ):
            return item
        return None

    def _inmemory_get_candidate_by_hash(self, question_hash: str) -> dict | None:
        """In-memory equivalent of exam_learned.get_candidate_by_hash()."""
        item = self._learned_by_hash.get(question_hash)
        if item and item.get("status") != "rejected":
            return item
        return None

    def _inmemory_get_by_phash(
        self,
        question_phash: str,
        max_distance: int,
        min_confidence: float,
        min_verified: int,
    ) -> dict | None:
        """In-memory pHash fuzzy match — replaces full table scan."""
        if not question_phash:
            return None
        best: dict | None = None
        best_distance = max_distance + 1
        for phash, item in self._learned_by_phash.items():
            if item.get("status") != "verified":
                continue
            if float(item.get("confidence") or 0) < min_confidence:
                continue
            if int(item.get("verified_count") or 0) < min_verified:
                continue
            if int(item.get("wrong_count") or 0) != 0:
                continue
            dist = _hamming(question_phash, phash)
            if dist < best_distance:
                best = item
                best_distance = dist
        if best and best_distance <= max_distance:
            best = dict(best)  # copy to avoid mutating index
            best["_phash_distance"] = best_distance
            return best
        return None

    def _inmemory_get_candidate_by_phash(
        self,
        question_phash: str,
        max_distance: int,
    ) -> dict | None:
        """In-memory pHash candidate lookup — replaces full table scan."""
        if not question_phash:
            return None
        best: dict | None = None
        best_distance = max_distance + 1
        for phash, item in self._learned_by_phash.items():
            if item.get("status") == "rejected":
                continue
            dist = _hamming(question_phash, phash)
            if dist < best_distance:
                best = item
                best_distance = dist
        if best and best_distance <= max_distance:
            best = dict(best)
            best["_phash_distance"] = best_distance
            return best
        return None
```

### Step 1.2: Replace SQL calls in solve() with in-memory lookups

**File**: `backend/app/services/exam_service.py`  
**Location**: Inside `solve()` method, lines 690-758

**Replace line 690-694** (exact hash lookup):
```python
        # OLD:
        learned = self._db.exam_learned.get_by_hash(
            question_hash,
            min_confidence=learn_min_confidence,
            min_verified=learn_min_confirmations,
        )
```
**With:**
```python
        learned = self._inmemory_get_by_hash(
            question_hash,
            min_confidence=learn_min_confidence,
            min_verified=learn_min_confirmations,
        )
```

**Replace line 717** (candidate hash lookup):
```python
        # OLD:
        candidate = self._db.exam_learned.get_candidate_by_hash(question_hash)
```
**With:**
```python
        candidate = self._inmemory_get_candidate_by_hash(question_hash)
```

**Replace lines 721-726** (pHash fuzzy lookup):
```python
        # OLD:
        learned = self._db.exam_learned.get_by_phash(
            question_phash,
            max_distance=learn_phash_max_distance,
            min_confidence=learn_min_confidence,
            min_verified=learn_min_confirmations,
        )
```
**With:**
```python
        learned = self._inmemory_get_by_phash(
            question_phash,
            max_distance=learn_phash_max_distance,
            min_confidence=learn_min_confidence,
            min_verified=learn_min_confirmations,
        )
```

**Replace line 756** (candidate pHash lookup):
```python
        # OLD:
        candidate = self._db.exam_learned.get_candidate_by_phash(question_phash, max_distance=learn_phash_max_distance)
```
**With:**
```python
        candidate = self._inmemory_get_candidate_by_phash(question_phash, max_distance=learn_phash_max_distance)
```

---

## T2: Remove Dead `_learned_json` Code

### Goal

Remove the unused `_learned_json` field that is loaded but never read.

**File**: `backend/app/services/exam_service.py`  
**Location**: Lines 187-196 inside `__init__`

**Delete these lines entirely:**
```python
        # Load learned questions JSON (auto-generated from exam feedback)
        learned_path = data_dir / "questions" / "questions_learned.json"
        self._learned_json: list[dict] = []
        if learned_path.exists():
            try:
                with learned_path.open(encoding="utf-8") as f:
                    self._learned_json = json.load(f)
                logger.info("exam_learned_json_loaded", extra={"context": {"count": len(self._learned_json)}})
            except Exception as e:
                logger.warning("exam_learned_json_load_failed", extra={"context": {"error": str(e)}})
```

**Note**: Do NOT delete the `export_learned_to_json()` method (line 234-246). That method is still called from `routes.py` to export data to the JSON file. We just don't load it back into memory anymore since the in-memory index replaces it.

---

## T3: Hot-Reload Index After Feedback

### Goal

When a user sends correct answer feedback, reload the in-memory index so the next solve benefits immediately.

**File**: `backend/app/api/routes.py`  
**Location**: Inside `exam_feedback()` function, after line 718 (after `db.upsert_exam_learned(...)`)

**Find this block (around line 718-728):**
```python
    result = db.upsert_exam_learned(
        question_hash=question_hash,
        ...
    )

    logger.info("exam_feedback_learned", extra={
```

**Add this line BETWEEN the upsert call and the logger.info call:**
```python
    # Hot-reload in-memory learned index so next solve benefits immediately
    container.exam_service._reload_learned_index()

    logger.info("exam_feedback_learned", extra={
```

---

## Verification

After completing T1-T3, verify:

### 1. Syntax Check
```bash
cd backend && python -c "from app.services.exam_service import ExamService; print('OK')"
```

### 2. Import Check  
```bash
cd backend && python -c "from app.api.routes import router; print('OK')"
```

### 3. Functional Check
```bash
cd backend && python -c "
from app.services.exam_service import _hamming
# Test hamming distance
assert _hamming('abcd', 'abcd') == 0
assert _hamming('abcd', 'abce') > 0
print('hamming OK')
"
```

### 4. Verify no references to old SQL methods in solve()
```bash
cd backend && grep -n "self._db.exam_learned.get_by_hash\|self._db.exam_learned.get_by_phash\|self._db.exam_learned.get_candidate" app/services/exam_service.py
```
**Expected**: No output (all replaced with in-memory methods). The `self._db.exam_learned` references should ONLY remain in `_reload_learned_index()` and `export_learned_to_json()`.

---

## Summary of Changes

| File | Lines Changed | What |
|------|--------------|------|
| `exam_service.py` | +~100 lines | Add `_reload_learned_index()`, 4 `_inmemory_*` methods, 2 dict fields |
| `exam_service.py` | -10 lines | Remove dead `_learned_json` code |
| `exam_service.py` | ~8 lines | Replace 4 SQL calls in `solve()` with in-memory calls |
| `routes.py` | +2 lines | Call `_reload_learned_index()` after feedback |
