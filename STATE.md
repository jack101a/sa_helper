# STATE.md - VCAM Stall URL Gate

## Status
COMPLETE

## Active Task
Restricted Sarathi VCAM/image-capture automation to STALL-related URLs only.

## Findings
- Repeated `[Automation] Captured SP_DOM_IMAGE...` and `User photo detected...` logs were coming from `sarathi_harden.js` watchers.
- Added strict `isStallRelatedUrl()` gate in `sarathi_harden.js`.
- `SarathiHarden.init()`, `SarathiImageDetector.init()`, and message listener now no-op on non-STALL pages (including `envaction.do`).

## Last Files Modified
- `extension/modules/sarathi_harden.js`
- `STATE.md`

## Last Command Run
`node --check extension/modules/sarathi_harden.js`

## Last Output/Error
- Syntax check passed with no errors.

## Verification Output Summary
- `grep` confirms stall URL gating present at:
  - `SarathiHarden.init()`
  - global message listener
  - `SarathiImageDetector.init()`
- `node --check` passed.

## Immediate Next Step
Reload extension in browser and verify on `.../envaction.do` that VCAM capture logs stop, while STALL URLs still activate automation.
