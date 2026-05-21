# AGENTS.md

## Purpose

This file tells the AI coding agent how to work in any project.

The human gives goals in plain English.
The AI agent must turn goals into tasks, work step by step, verify the work, track progress, and ask for review when needed.

Work safely.
Make small changes.
Do not over-engineer.

---

## Main Workflow

For every user request or plan:

1. Read `AGENTS.md`
2. Read `STATE.md` if it exists
3. Read any plan or instruction file if provided
4. Create or update `TASK_QUEUE.md`
5. Pick one task only
6. Create or update `TASK.md`
7. Work on that task only
8. Verify the result
9. Update `STATE.md`
10. Mark the task complete in `TASK_QUEUE.md`
11. Continue to the next task

Do not work on multiple tasks at once.

---

## Task Auto-Generation Rule

Before any coding:

If `TASK_QUEUE.md` does not exist or is empty:
- create it from the user request, plan, or instruction file
- split large work into small tasks
- group tasks into phases when useful

If `TASK.md` does not exist or is empty:
- pick the next pending task from `TASK_QUEUE.md`
- create `TASK.md` for that task

Never start coding without a current `TASK.md`.

---

## Required Files

Use these files:

- `TASK_QUEUE.md` = all tasks and phases
- `TASK.md` = current active task only
- `STATE.md` = progress, results, and next step
- `REVIEW.md` = review notes and feedback

Create missing files when needed.

---

## TASK_QUEUE.md Rules

`TASK_QUEUE.md` should include:

- task list
- phase list if useful
- pending tasks
- in-progress task
- completed tasks
- blocked tasks

Only one task can be in progress.

If the work is large, divide it into phases.

Example phases:

- Phase 1: Quick fixes
- Phase 2: Main implementation
- Phase 3: Refactor
- Phase 4: Tests
- Phase 5: Cleanup

Use phases only when helpful.

---

## TASK.md Rules

`TASK.md` must describe only the current task.

It should include:

- task ID
- goal
- scope
- files likely affected
- steps to follow
- verification method
- completion checklist

Keep tasks small.

If a task is too large, split it before coding.

---

## Coding Rules

Make minimal, safe changes.

Before editing a file:

1. Read the file
2. Understand the current style
3. Edit only what is needed
4. Avoid unrelated changes

Do not rewrite full files unless necessary.

Do not change behavior outside the task scope.

Do not add new libraries unless clearly needed.

If a new library is needed, document why in `STATE.md`.

---

## Scope Rules

Do not:

- add features not requested
- refactor unrelated code
- rename files without need
- change public APIs without need
- change database or backend behavior unless asked
- remove existing behavior unless asked
- make large rewrites for small tasks

Stay focused on the current task.

---

## Verification Rules

After each task, run the best available check.

Use whichever applies:

- build command
- test command
- lint command
- type-check command
- format check
- manual runtime check

If unsure, inspect project files to find the correct command.

If no verification command exists, document that in `STATE.md` and do the closest useful check.

A task is not complete until verification is done or clearly documented.

---

## STATE.md Rules

After every completed task, update `STATE.md`.

Include:

- current phase, if any
- current task
- current status
- files changed
- command run
- command result
- errors, if any
- assumptions made
- next step

Do not leave `STATE.md` outdated.

---

## Phase Execution Rule

If tasks are grouped into phases:

- finish all tasks in the current phase first
- do not move to the next phase early
- after the phase is complete, ask for review
- fix review issues before moving on

If tasks are not grouped into phases, review after a meaningful group of related tasks.

---

## Phase Review Rule

After finishing a phase, ask the review agent:

@verify Review this completed phase.

Check:
- correctness
- regressions
- code quality
- missed edge cases
- scope violations
- test or build issues

Include:
- completed task IDs
- files changed
- commands run
- known assumptions or limitations

Save the review result in `REVIEW.md`.

If review finds issues:
- convert each issue into a task
- add the tasks to `TASK_QUEUE.md`
- complete them one by one
- verify again

Only move to the next phase after review issues are fixed or clearly documented.

---

## Final Review Rule

After all tasks and phases are complete, ask the review agent:

@verify Perform a final full review.

Check:
- correctness
- stability
- code quality
- regressions
- missing work
- risky changes
- build/test status

Save the review result in `REVIEW.md`.

If final review finds issues:
- convert issues into tasks
- add them to `TASK_QUEUE.md`
- complete them one by one
- verify again
- ask for final review again

The work is complete only after final review is clean or remaining issues are clearly documented.

---

## Error Handling

If an error happens:

1. Reproduce the error
2. Read the full error message
3. Inspect the related code
4. Find the cause
5. Make the smallest fix
6. Verify again

If the same error happens twice, stop and write:

[BLOCKER INITIATED: REQUIRES HUMAN INPUT]

Then explain:
- what failed
- what was tried
- what information is needed

---

## When Unsure

First inspect relevant files.

Make the safest small assumption and document it in `STATE.md`.

Ask the human only if:

- data loss is possible
- secrets or credentials are needed
- there are multiple risky choices
- external service access is required
- backend/database behavior must change
- the same error happens twice

Do not ask questions for things that can be safely discovered from the code.

---

## Communication Style

Use simple English.

Be direct.

Explain what you are doing briefly.

Do not write long theory.

Do not make unrelated suggestions while executing a task.

---

## Completion Rules

A task is complete only when:

- the task work is done
- verification was run or clearly documented
- `STATE.md` was updated
- `TASK_QUEUE.md` was updated

A phase is complete only when:

- all phase tasks are complete
- phase review was done
- review issues were fixed or documented

The full request is complete only when:

- all tasks are complete
- final review was done
- final review issues were fixed or documented

---

## Most Important Rules

Always create tasks before coding.

Always work on one task at a time.

Always keep changes small.

Always verify after changes.

Always update `STATE.md`.

Always ask for review after each phase.

Always ask for final review after all work is done.

Do not skip steps.