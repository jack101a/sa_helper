# TASK.md - Extension Fixed Server Distribution

## Goal
Recheck the extension distribution flow, hardcode the production backend URL for user builds, remove user-facing server URL entry, and show popup ping status as a light only.

## Status
COMPLETE

## Scope Included
- Keep source extension files readable.
- Keep download artifacts packaged from minified temporary copy.
- Hardcode `https://tata-ocs.duckdns.org` in extension runtime paths.
- Popup auth asks only for API key.
- Popup connection/ping status renders only red/yellow/green light, no status text or ms.
- Regenerate distributable extension artifacts.

## Scope Excluded
- Changing backend auth behavior.
- Renaming manifest-referenced extension files.
- Aggressive obfuscation that risks Chrome extension CSP/runtime breakage.

## Plan
- [x] Re-read extension packaging and popup/options/background flow.
- [x] Hardcode extension backend URL and remove editable URL fields.
- [x] Convert popup connection status to light-only display.
- [x] Regenerate obfuscated user distribution package.
- [x] Verify package contents and frontend/backend checks.
- [x] Update STATE.md.

## Verification
- `./.venv/bin/python -m py_compile backend/app/services/extension_service.py`
- Package smoke test through `ExtensionService.package_extension()`.
- Inspect generated ZIP for hardcoded URL and minified JS.
- `cd frontend && npm run build`
