# 06 — Implementation Plan & Task Queue (COMPLETE)

> **Purpose**: Step-by-step implementation plan for Codex to execute.  
> **Codebase Commit**: `5e64786`  
> **Rule**: Each task is self-contained. Complete one before starting the next.

---

## Task Queue (Execution Order)

### P0 — MCQ In-Memory Index (Critical Performance Fix)
| # | Task | Depends On |
|---|------|------------|
| T1 | Add in-memory hash/phash index to ExamService | — |
| T2 | Remove dead `_learned_json` code | — |
| T3 | Hot-reload index after exam feedback | T1 |

📄 **Task file**: [06a-task-p0-inmemory-index.md](./06a-task-p0-inmemory-index.md)

---

### P1 — MCQ Auto-Merge Pipeline
| # | Task | Depends On |
|---|------|------------|
| T4 | Create `ExamMergeService` | T1 |
| T5 | Add merge scheduler (background task) | T4 |
| T6 | Admin merge endpoint + training stats | T4 |

📄 **Task file**: [06b-task-p1-auto-merge.md](./06b-task-p1-auto-merge.md)

---

### P2 — Backup & Restore System
| # | Task | Depends On |
|---|------|------------|
| T7 | System/user backup split | — |
| T8 | rclone integration | T7 |
| T9 | Telegram channel backup | T7 |
| T10 | Backup scheduler + admin API | T7-T9 |

📄 **Task file**: [06c-task-p2-backup-system.md](./06c-task-p2-backup-system.md)

---

### P3 — Telegram Plans, Entitlements & Lifecycle
| # | Task | Depends On |
|---|------|------------|
| T11 | Plan entitlement columns (max_devices, allowed_services) | — |
| T12 | Service entitlement enforcement in payment approval | T11 |
| T13 | Device limit per plan | T11 |
| T14 | Subscription auto-expiry scheduler | — |
| T15 | Telegram /renew command + expiry warnings | T14 |

📄 **Task file**: [06d-task-p3-telegram-plans.md](./06d-task-p3-telegram-plans.md)

---

### P4 — Test Harness & CI Pipeline
| # | Task | Depends On |
|---|------|------------|
| T16 | Create `conftest.py` with shared fixtures | — |
| T17 | Auth middleware tests (dual-key flow) | T16 |
| T18 | Admin guard tests | T16 |
| T19 | GitHub Actions CI pipeline | T16-T18 |

📄 **Task file**: [06e-task-p4-tests-ci.md](./06e-task-p4-tests-ci.md)

---

### P5 — Docker Production & Deployment
| # | Task | Depends On |
|---|------|------------|
| T20 | Harden `docker-entrypoint.sh` (Alembic, dirs) | — |
| T21 | Production `docker-compose.prod.yml` | — |
| T22 | Dockerfile HEALTHCHECK + rclone | — |

📄 **Task file**: [06f-task-p5-docker-production.md](./06f-task-p5-docker-production.md)

---

### P6 — Database Unification (Inline DDL → Alembic)
| # | Task | Depends On |
|---|------|------------|
| T23 | Guard `create_all_tables()` behind debug flag | — |
| T24 | Alembic baseline migration (full schema) | T23 |
| T25 | Refactor `database.py:init()` to use fallback pattern | T24 |

📄 **Task file**: [06g-task-p6-database-unification.md](./06g-task-p6-database-unification.md)

---

### P7 — Security Hardening
| # | Task | Depends On |
|---|------|------------|
| T26 | Auth fallthrough → ERROR level + structured logging | — |
| T27 | Base64 image payload validation (size limits) | — |
| T28 | Admin session cookie security flags | — |

📄 **Task file**: [06h-task-p7-security-hardening.md](./06h-task-p7-security-hardening.md)

---

### P8 — Modular Monolith (Route Decomposition)
| # | Task | Depends On |
|---|------|------------|
| T29 | Split `routes.py` (1058 lines) into 5 module route files | — |
| T30 | Create service module boundary documentation | — |
| T31 | Add module grouping comments to container.py | — |

📄 **Task file**: [06i-task-p8-modular-monolith.md](./06i-task-p8-modular-monolith.md)

---

### P9 — Frontend State Management & Extension Build
| # | Task | Depends On |
|---|------|------------|
| T32 | Create `AdminDataContext` (extract 16 useState from App.jsx) | — |
| T33 | Add plan entitlement fields to PlansPanel | T11 |
| T34 | Add training stats + merge button to ExamStatsPanel | T6 |

📄 **Task file**: [06j-task-p9-frontend-extension.md](./06j-task-p9-frontend-extension.md)

---

## Coverage Matrix (06 Tasks vs 05 Architecture Plan)

| 05 Opus Plan Section | 06 Codex Task | Status |
|---------------------|---------------|--------|
| Phase 0: Test harness + CI | 06e (T16-T19) | ✅ |
| Phase 1: Database unification | 06g (T23-T25) | ✅ |
| Phase 2: Modular monolith | 06i (T29-T31) | ✅ |
| Phase 3: Frontend + extension | 06j (T32-T34) | ✅ |
| Phase 4: Docker/deployment | 06f (T20-T22) | ✅ |
| Phase 5: Security hardening | 06h (T26-T28) | ✅ |
| Phase 6: Scaling (Redis) | — | ⏳ Deferred (not needed <100 users) |
| 05a: Capacity/Oracle VPS | 06f (T21) | ✅ (prod compose) |
| 05b: Telegram plans + lifecycle | 06d (T11-T15) | ✅ |
| 05c: MCQ auto-training | 06a + 06b (T1-T6) | ✅ |
| 05d: Backup/restore + rclone | 06c (T7-T10) | ✅ |

**Only Phase 6 (Redis/scaling) deferred** — not needed until capacity limits are hit.

---

## Codex Instructions

### Before Starting ANY Task

1. Read `AGENTS.md` in the project root
2. Read `STATE.md` to understand current state
3. Read the specific task file (e.g., `06a-task-p0-inmemory-index.md`)
4. Read ALL files listed in the task's "Files to Read First" section
5. Follow the task steps EXACTLY — do not add features, do not refactor other code

### After Completing Each Task

1. Run the verification command specified in the task
2. Update `STATE.md` with what was done
3. Update `TASK.md` with completion status
4. Commit with the message format: `[T{N}] {description}`

### Rules

- **SURGICAL edits only** — do NOT rewrite entire files
- **Preserve all existing comments and docstrings**
- **Do NOT change function signatures** unless explicitly told to
- **Do NOT import new dependencies** unless explicitly listed
- **Test after every change** — if test fails, fix before moving on
- **One task at a time** — finish or fail before starting next

---

## Recommended Execution Order

```
Batch 1 (core features):     T1 → T2 → T3 → T4 → T5 → T6
Batch 2 (backup):            T7 → T8 → T9 → T10
Batch 3 (plans/lifecycle):   T11 → T12 → T13 → T14 → T15
Batch 4 (tests):             T16 → T17 → T18 → T19
Batch 5 (docker):            T20 → T21 → T22
Batch 6 (database):          T23 → T24 → T25
Batch 7 (security):          T26 → T27 → T28
Batch 8 (modular monolith):  T29 → T30 → T31
Batch 9 (frontend):          T32 → T33 → T34
```

**Total**: 34 tasks across 10 files.
