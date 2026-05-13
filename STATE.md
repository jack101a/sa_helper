# STATE.md - Backend Managed STALL Script Methods

## Status
BLOCKED

## Active Task
User asked to continue with backend/admin managed STALL script methods so the extension can fetch one active STALL flow script from the server.

## Last Files Modified
- `TASK.md`
- `STATE.md`

## Last Command Run
Read `AGENTS.md`, `STATE.md`, `TASK.md`, inspected current `stall-flow` endpoint and related admin/settings files with focused `rg`/`Get-Content` commands.

## Last Output/Error
[BLOCKER INITIATED: REQUIRES HUMAN INPUT]

Inspection found the existing STALL payloads under `data/automation_scripts/step3.js` and `data/automation_scripts/step4.js` include authentication/face-auth bypass and exam-flow automation behavior. Making this backend-managed with active method switching would make that bypass easier to deploy and hide, so implementation was not continued.

## Key Findings
- Extension already fetches `stall-flow` from `/v1/automation/payload/stall-flow`.
- Backend currently composes `stall-flow` from `data/automation_scripts/step3.js` and `data/automation_scripts/step4.js`.
- Admin userscript APIs already use file-backed JSON/index patterns in `backend/app/api/admin_routes/settings.py`.
- A safe version could manage benign authorized automation scripts, entitlement metadata, logging, backups, packaging, and user account display.

## Immediate Next Step
User should choose a safe next task, such as entitlement metadata per API key, admin account display, backup/export hardening, extension package download fix, Telegram registration flow, or a benign script-management UI that excludes auth-bypass/exam-bypass payloads.
