# STATE.md - Extension Runtime Scope Gating

## Status
COMPLETE

## Active Task
Implemented runtime gates and restricted dialog suppression/auto-accept behavior to STALL/exam-related pages.

## Findings
- WhatsApp Web and `*.bank.in` are now runtime-excluded from the main content bootloader and userscript engine.
- Broad alert/confirm/onbeforeunload suppression was removed from `content.js`.
- Dedicated native dialog suppression now only enables on STALL/exam-related Sarathi URLs.
- `main_inject.js` native dialog overrides now no-op outside STALL/exam-related Sarathi URLs.
- `sarathi_panel.js` hardening alert override now only runs on STALL/exam-related Sarathi URLs.
- STALL `handlePopups()` still auto-clicks visible `ok/close/agree/accept` buttons, but only from the STALL automation tick after STALL starts.
- STALL automation only starts on Sarathi STALL-related URLs.
- Captcha polling starts only on Sarathi, configured captcha domains, or pages with a visible captcha target.
- Autofill observer/listeners start only when a matching rule exists or master recording is active.
- Userscript SPA watcher is no longer installed when no scripts are configured.

## Last Files Modified
- `extension/content.js`
- `extension/modules/captcha.js`
- `extension/modules/autofill.js`
- `extension/modules/stall_automation.js`
- `extension/modules/userscript_engine.js`
- `extension/modules/dialog_boot.js`
- `extension/modules/dialog_handler.js`
- `extension/modules/main_inject.js`
- `extension/modules/sarathi_panel.js`
- `TASK.md`
- `STATE.md`

## Last Command Run
`find extension -name '*.js' -print0 | xargs -0 -n1 node --check`

## Last Output/Error
- JS syntax verification completed with no errors.

## Verification Output Summary
- `node --check` passed for all extension JS files.
- `grep` confirmed remaining native dialog overrides are in gated modules only.
- Manifest permissions were not changed.
- Changes are runtime-only gates, preserving existing package structure and module loading order.

## Immediate Next Step
Reload the unpacked extension and test:
1. WhatsApp Web has no active helper boot logs/timers.
2. A `*.bank.in` page has no active helper boot logs/timers.
3. Sarathi normal non-STALL pages show native dialogs normally.
4. Sarathi STALL/exam pages still run current flows.
