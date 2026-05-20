# 05c — MCQ Auto-Training Pipeline (Revised)

> Part of [05-opus-final-architecture-plan.md](./05-opus-final-architecture-plan.md)  
> **This replaces the previous version with findings from deep code inspection.**

---

## Current Data Inventory

| Data | File | Size | 
|------|------|------|
| Static question bank | `data/questions/questions.json` | **300 questions** |
| Learned questions JSON | `data/questions/questions_learned.json` | **Empty `[]`** (never populated in prod) |
| Sign hashes (DJB2) | `data/hashes/sign_hashes.json` | **94 signs** |
| Sign labels | `data/hashes/sign_label.json` | **94 labels** |
| Sign pHashes | `data/hashes/sign_hashes_perceptual.json` | Empty `{}` |
| Learned DB table | SQLite `exam_learned` | Grows from feedback |
| Offline images | `data/exam_offline/questions/` | Saved per feedback |

---

## How the Solve Pipeline Works RIGHT NOW

When a user takes an exam question, here's what happens step by step:

```
User's extension sends: question_image + 4 option_images
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  LAYER 1 — Sign Hash Match (IN-MEMORY, ~1ms)               │
│                                                             │
│  1. Compute DJB2 hash of question image                     │
│  2. Look up in self._sign_hashes dict (94 entries)          │  ← instant
│  3. If match: compute pHash, store for future fuzzy match   │
│  4. Look up sign label in questions.json                    │
│  5. Return answer                                           │
│                                                             │
│  ONLY works for road sign images (94 signs)                 │
│  Text questions → fall through                              │
└─────────────────────┬───────────────────────────────────────┘
                      │ no match
                      ▼
┌─────────────────────────────────────────────────────────────┐
│  LAYER 1.5 — Learned DB Lookup (DATABASE, 5-200ms)          │
│                                                             │
│  1. Compute DJB2 hash + pHash of question image             │
│  2. SQL: SELECT * WHERE question_hash = ?    (indexed, fast)│
│  3. SQL: SELECT * WHERE question_hash = ?    (candidate)    │
│  4. SQL: SELECT * FROM exam_learned          ← FULL SCAN!   │
│     → Load ALL rows into Python                             │
│     → Compute Hamming distance for EACH row                 │
│  5. SQL: SELECT * FROM exam_learned          ← FULL SCAN!   │
│     → Same thing again for candidates                       │
│                                                             │
│  4 DB queries per solve, 2 are FULL TABLE SCANS             │
│  Gets SLOWER as learned DB grows!                           │
└─────────────────────┬───────────────────────────────────────┘
                      │ no match
                      ▼
┌─────────────────────────────────────────────────────────────┐
│  LAYER 2 — OCR + Text Match (SLOW, 1-4 seconds)            │
│                                                             │
│  1. Tesseract OCR question image (200-800ms)                │
│  2. Tesseract OCR 4 option images (200-800ms each, parallel)│
│  3. Search self._questions list (300 entries):              │
│     - Substring match on question_text                      │
│     - Reverse option matching                               │
│     - Hindi-normalized fuzzy match                          │
│  4. Return matched answer                                   │
│                                                             │
│  MOST EXPENSIVE layer — CPU-bound OCR                       │
└─────────────────────┬───────────────────────────────────────┘
                      │ no match
                      ▼
┌─────────────────────────────────────────────────────────────┐
│  LAYER 3 — LLM Fallback (NETWORK, 2-10 seconds)            │
│                                                             │
│  1. Send question + options to LiteLLM/Gemini API           │
│  2. AI reads the images and picks answer                    │
│  3. Return answer                                           │
│                                                             │
│  Costs money per call, slowest, but always available        │
└─────────────────────────────────────────────────────────────┘
```

---

## What's Broken / Wasted

### 🔴 BUG: `_learned_json` is Dead Code

```python
# exam_service.py:187-196 — LOADED but NEVER USED
self._learned_json: list[dict] = []      # loaded from questions_learned.json
# ... but NO function in solve() ever reads self._learned_json
```

The `questions_learned.json` file is exported after each feedback, but **never searched during solve**. The learned data is ONLY accessed via the slow SQL queries. This means the JSON export is completely wasted work.

### 🔴 pHash Lookup is O(n) Full Table Scan

```python
# exam_learned.py:250-274
def _nearest_phash(self, question_phash, max_distance, verified_only):
    rows = conn.execute("SELECT * FROM exam_learned WHERE ...").fetchall()  # ALL rows
    for row in rows:           # iterate every single one
        distance = self._hex_hamming(question_phash, item["question_phash"])
```

With 5000 learned questions × 4 concurrent users = scanning 20,000 rows in Python.

### 🟡 Offline Dataset Collected But Never Used

`data/exam_offline/questions/{hash}/` has PNG images + metadata.json for every correct answer, but nothing processes these. They're insurance for manual review, not automated.

### 🟡 No Auto-Merge to Main Bank

Verified learned questions (status=`verified`, confidence≥0.95, verified_count≥10) never merge into `questions.json`. This means Layer 2 text-match never benefits from learned data.

---

## The Fix: Self-Improving MCQ Solver

Here's exactly what to implement, in order:

### Step 1: In-Memory Hash Index (Fixes the speed problem)

Replace the 4 slow SQL queries with in-memory dict lookups:

```python
class ExamService:
    def __init__(self, db, data_dir):
        # ... existing init ...
        
        # NEW: In-memory learned index (replaces SQL queries in solve)
        self._learned_by_hash: dict[str, dict] = {}    # question_hash → learned row
        self._learned_by_phash: dict[str, dict] = {}   # question_phash → learned row
        self._reload_learned_index()
    
    def _reload_learned_index(self):
        """Load all non-rejected learned questions into memory."""
        rows = self._db.exam_learned.get_all_learned(min_confidence=0.0)
        self._learned_by_hash = {}
        self._learned_by_phash = {}
        for row in rows:
            if row.get("status") == "rejected":
                continue
            h = row.get("question_hash", "")
            p = row.get("question_phash", "")
            if h:
                self._learned_by_hash[h] = row
            if p:
                self._learned_by_phash[p] = row
        logger.info("learned_index_loaded", extra={"context": {
            "hash_count": len(self._learned_by_hash),
            "phash_count": len(self._learned_by_phash),
        }})
```

**In solve()**, replace:
```python
# OLD (4 SQL queries, 2 full scans):
learned = self._db.exam_learned.get_by_hash(question_hash, ...)
candidate = self._db.exam_learned.get_candidate_by_hash(question_hash)
learned = self._db.exam_learned.get_by_phash(question_phash, ...)
candidate = self._db.exam_learned.get_candidate_by_phash(question_phash, ...)

# NEW (4 dict lookups, O(1) + O(n) in-memory):
learned = self._learned_by_hash.get(question_hash)  # O(1)
# For pHash: scan in-memory dict (same speed but no DB/Python dict conversion)
learned = self._find_nearest_phash(question_phash, max_distance=3)  # in-memory
```

**Result**: Solve goes from ~50-200ms for Layer 1.5 to **<1ms**.

### Step 2: Auto-Reload After Feedback

When a new correct answer comes in, the in-memory index needs updating:

```python
# In routes.py exam_feedback endpoint, after upsert_exam_learned():
container.exam_service._reload_learned_index()  # hot reload
```

This is cheap — loading 5000 dict entries from SQLite takes ~10ms.

### Step 3: Auto-Merge Verified → Main Bank

Once a question reaches `verified` status (confidence≥0.95, seen 10+ times, 0 wrong):

```python
class ExamMergeService:
    def merge_verified(self):
        """Merge verified learned questions into questions.json AND memory."""
        verified = self._db.exam_learned.export_to_json()
        existing_hashes = {q.get("_question_hash", "") for q in self._exam_service._questions}
        
        merged = 0
        for entry in verified:
            if entry.get("_question_hash") not in existing_hashes:
                self._exam_service._questions.append(entry)  # hot-add to memory
                merged += 1
        
        if merged > 0:
            # Persist to disk
            self._save_questions_json(self._exam_service._questions)
            logger.info(f"Merged {merged} verified questions into main bank")
        
        return merged
```

**Why this matters**: After merge, even if the in-memory index is cold (server restart), the question is now in `questions.json` and can be found by Layer 2 text matching.

### Step 4: The Flywheel Effect (What You Get)

```
Month 1 (5 users):
├─ questions.json: 300 static questions
├─ exam_learned: ~200 entries (mostly training status)
├─ Most solves: Layer 2 (OCR) or Layer 3 (LLM) — SLOW
└─ Response time: 1-4 seconds per question

Month 2 (20 users):
├─ questions.json: 300 + ~100 merged = 400 questions
├─ exam_learned: ~800 entries, ~100 verified
├─ 25% of solves: Layer 1.5 (hash match) — INSTANT
├─ 50% of solves: Layer 2 (OCR+text) — 1-4 seconds  
├─ 25% of solves: Layer 3 (LLM) — 2-10 seconds
└─ Average response: ~2 seconds

Month 3 (50 users):
├─ questions.json: 300 + ~500 merged = 800 questions
├─ exam_learned: ~2000 entries, ~500 verified
├─ 60% of solves: Layer 1.5 (hash match) — INSTANT (<5ms)
├─ 30% of solves: Layer 2 (OCR+text) — 1-2 seconds
├─ 10% of solves: Layer 3 (LLM) — 2-10 seconds
└─ Average response: ~500ms

Month 6 (50-100 users):
├─ questions.json: 300 + ~2000 merged = 2300+ questions  
├─ exam_learned: ~4000 entries, ~2000 verified
├─ 90%+ of solves: Layer 1.5 (hash match) — INSTANT
├─ 8% of solves: Layer 2 (OCR+text) — 1-2 seconds
├─ 2% of solves: Layer 3 (LLM) — rare
└─ Average response: <100ms ← ALMOST FREE (no OCR, no LLM)
```

**The key insight**: The Sarathi exam portal has a **finite question bank** (~5000 questions). Once your 50 users have collectively seen most questions, the system resolves >90% of questions via hash lookup — **zero OCR, zero LLM, zero cost, instant response**.

---

## What About the Offline Dataset Images?

The `data/exam_offline/questions/{hash}/` PNG images serve two purposes:

1. **Manual review**: Admin can visually verify learned questions
2. **Re-OCR with better quality**: The initial OCR during solve is fast but unreliable (`ocr_preview_unreliable=True`). The saved PNGs can be re-OCR'd at leisure for better text quality in the merged questions.json

**Recommendation**: Keep saving them (cheap storage), but they're **not needed for the auto-training pipeline**. The hashes alone are sufficient for matching.

---

## Exact Files to Change

| Priority | File | What |
|----------|------|------|
| **P0** | `exam_service.py` | Add `_learned_by_hash`, `_learned_by_phash` dicts + `_reload_learned_index()` + replace SQL calls in `solve()` with dict lookups |
| **P0** | `routes.py` | Call `_reload_learned_index()` after `upsert_exam_learned()` in `exam_feedback` |
| **P0** | `exam_service.py` | Delete dead `_learned_json` code (lines 187-196) |
| **P1** | `exam_merge_service.py` | [NEW] Auto-merge verified entries into `questions.json` + hot-reload |
| **P1** | `container.py` | Wire `ExamMergeService` |
| **P1** | `main.py` | Schedule merge every 6 hours |
| **P2** | Admin dashboard | Show training pipeline stats + force-merge button |

**P0 changes are ~50 lines of code and can be done in 1 session.**

---

## Summary

| Question | Answer |
|----------|--------|
| PostgreSQL needed? | **No, not now.** SQLite with WAL mode is fine. The bottleneck was the Python full-scan, not the DB engine. |
| How to use offline data? | **Hash-based auto-learning already exists.** Fix: move lookups from SQL to in-memory dicts. Add auto-merge scheduler. |
| Will OCR become unnecessary? | **Yes!** After 2-3 months with 50 users, ~90% of questions resolve via hash — no OCR, no LLM, instant. |
| What about `_learned_json`? | **Dead code.** Loaded but never used in solve. Replace with in-memory index. |
