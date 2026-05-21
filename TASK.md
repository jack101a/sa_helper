# TASK.md - Extension Runtime Scope Gating

## Goal
Reduce extension background work on unrelated websites while preserving current Sarathi, STALL, exam, captcha, autofill, and userscript behavior.

## Status
COMPLETE

## Scope Included
- Add runtime excluded-site gate for WhatsApp Web and `*.bank.in`.
- Gate main module activation in `content.js`.
- Add internal guard to `StallAutomation.start()`.
- Avoid starting captcha interval when current page/domain has no captcha target.
- Avoid installing autofill observer when no matching rule exists and recording is off.
- Avoid userscript SPA watcher on excluded sites.
- Remove broad dialog suppression.
- Limit native dialog auto-accept/suppression to STALL/exam-related Sarathi pages.

## Scope Excluded
- Narrowing manifest host permissions.
- Removing existing modules.
- Changing Sarathi/STall/exam solving behavior.

## Plan
- [x] Read current extension activation files.
- [x] Patch runtime excluded-site guards.
- [x] Patch module start guards.
- [x] Remove broad dialog suppressor.
- [x] Gate remaining dialog handlers to STALL/exam URLs.
- [x] Run JS syntax verification.
- [x] Update STATE.md.

## Verification
- `node --check` on modified extension JS files.
