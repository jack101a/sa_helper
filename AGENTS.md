
#  AI Agent Operating Directives (Full System)


## 0. Continuous Execution Loop (CRITICAL)

You are NOT a one-step assistant.

You MUST operate in a continuous loop:

1. Read AGENTS.md (this file) every cycle
2. Read STATE.md
3. Follow TASK.md
4. Execute one step
5. Update STATE.md
6. Repeat

This loop NEVER stops unless:
- Task is fully complete
- OR [BLOCKER INITIATED]

You MUST re-check AGENTS.md periodically to stay aligned with rules.


## 1. Role Definition
- Human defines WHAT (plain English)
- AI defines HOW (implementation, debugging, structure)
- AI is responsible for correctness, execution, and continuity

---

## 2. Directory Routing (MANDATORY)

DO NOT scan entire repository.

- `/src/`  production logic  MUST read `/src/workflow.md`
- `/test/`  testing  MUST read `/test/workflow.md`
- `/tmp/`  logs/data  MUST read `/tmp/workflow.md`

Violation = incorrect execution

---

## 3. Full Execution Protocol

### Step 1: SYNC
- Read `/STATE.md`
- Understand:
  - Active Task
  - Last Error
  - Immediate Next Step

---

### Step 2: UNDERSTAND
- Read ONLY relevant files
- DO NOT scan whole repo
- If unclear  ask user BEFORE coding

---

### Step 2.5: TASK PLANNING (MANDATORY for non-trivial tasks)

- Create or update `/TASK.md`
- Define:
  - Goal
  - Scope (included / excluded)
  - Step-by-step plan
  - Verification approach

- DO NOT start coding until TASK.md is clear

---

### Step 3: PLAN (Brief)
- Explain approach in 1�2 lines

---

### Step 4: ACT (STRICT)

- Read file using `cat` BEFORE editing
- Re-read file AGAIN before applying changes
- Apply SURGICAL edits (NO full rewrites)
- Keep code simple and readable
- Follow `/src/workflow.md` or relevant workflow

---

### Step 5: VERIFY (MANDATORY)

- Run the code
- Show terminal output
- Confirm expected behavior
- Test at least one edge case if applicable

---

### Step 6: RECORD (CRITICAL)

You MUST update `/STATE.md`:

- Last Files Modified
- Last Command Run
- Last Output/Error
- Immediate Next Step
- Update task status

If STATE.md is NOT updated  task is incomplete

---

## 4. Debugging Protocol (STRICT)

When error occurs:

1. Reproduce the error
2. Add logging (`console.log` / `print`)
3. Inspect real values (types, nulls, structure)
4. Identify exact cause
5. Apply minimal fix

If SAME error occurs twice:
 `[BLOCKER INITIATED: REQUIRES HUMAN INPUT]`

---

## 5. File Safety Rule

- Always read file BEFORE editing
- Always re-read BEFORE applying changes
- Never assume file is unchanged

---

## 6. Scope Discipline

- Do NOT add features not requested
- Do NOT refactor working code
- Do NOT over-engineer
- Do NOT introduce new frameworks without need

---

## 7. Conditional Web Research

Only perform research if:
- unfamiliar library/API
- unclear implementation
- version-specific behavior

DO NOT research basic logic

---

## 8. Completion Gate (MANDATORY)

Task is NOT complete unless:

- Code runs without errors
- Terminal output is shown
- Output matches expected behavior
- STATE.md is updated
- No unfinished steps in TASK.md

---

## 9. Single Task Focus

- Only ONE task at a time
- Do NOT switch mid-task
- Finish or fail before moving on

---

## 10. Recovery Behavior

On restart:

- Read `/STATE.md`
- Resume from "Immediate Next Step"
- Continue without asking user again
