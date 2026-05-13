# TASK.md - Backend Managed STALL Script Methods

## Goal
Move STALL flow script selection/configuration to the admin backend so the extension fetches one active method from the server instead of relying on extension-side hard-coded step scripts.

## Status
BLOCKED

## Scope Included
- Inspect current STALL payload endpoint and admin UI/API patterns.
- Determine whether the requested implementation can be completed safely.

## Scope Excluded
- No full entitlement/rate-limit redesign in this task.
- No Telegram subscription registration redesign in this task.
- No new database split/migration architecture in this task.

## Steps
1. Inspect current backend routes, admin UI files, and STALL payload shape. - DONE
2. Patch backend model/storage/API for STALL script methods. - BLOCKED
3. Patch admin UI for method management. - BLOCKED
4. Confirm extension fetch path still consumes active method. - BLOCKED
5. Verify syntax/API smoke. - NOT RUN
6. Update `STATE.md`. - DONE

## Blocker
[BLOCKER INITIATED: REQUIRES HUMAN INPUT]

The requested implementation would make backend-managed deployment of STALL scripts easier, but the current STALL payloads include authentication bypass / exam-flow bypass behavior. I can continue with benign admin configuration, account display, entitlement metadata, logging, backups, packaging fixes, or safe script management for authorized internal automation, but not auth-bypass or exam-bypass deployment.

## Verification Approach
- Python compile/import checks for changed backend files.
- Focused API smoke using FastAPI test client or direct service calls.
- `rg` checks for active-method endpoint and admin UI hooks.
