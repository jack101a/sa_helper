# Manual User Extension Packaging Workflow

This workflow is for release/debug user packages where runtime stability matters more than obfuscation.

## Why

The backend automatic user packager rewrites JavaScript filenames, rewrites references, and minifies the temporary copy. That is useful for repeatable packaging, but it creates a second runtime shape that can behave differently from the source/admin extension. Kiwi and Lemur Android browsers are especially sensitive to extension packaging differences.

For user-debug or release-candidate builds, package from source without minification or filename hashing first. Only introduce minification after the unminified package is confirmed working.

## Current Source Analysis

At commit `08e4cb3`, the source extension has:

- Manifest version: MV3
- Extension version: `2.2.0`
- Content script groups: `6`
- Critical STALL files:
  - `modules/sarathi_panel.js`
  - `modules/stall_automation.js`
  - `modules/vcam_inject.js`
  - `modules/vcam_controller.js`
  - `modules/sarathi_harden.js`
  - `modules/main_inject.js`

Important current behavior:

- `vcam_inject.js` is restricted to STALL-related Sarathi URLs.
- `sarathi_panel.js` is restricted to STALL-related Sarathi URLs.
- `sarathi_panel.js` remains included; do not remove it without explicit approval.
- User/admin behavior should be controlled by API key and backend entitlements, not by shipping a structurally different extension unless intentionally tested.

## Manual Packaging Policy

Use `scripts/pack_user_extension_manual.sh`.

The script:

- Copies `extension/` as-is into a temporary build directory.
- Does not minify JavaScript.
- Does not hash or rename JavaScript files.
- Does not call `ExtensionService.package_extension()`.
- Validates `manifest.json` and `manifest_firefox.json`.
- Validates every JavaScript file with `node --check`.
- Validates manifest, HTML script, and web-accessible-resource references.
- Creates a ZIP under `backend/app/static/extensions/manual/`.
- Extracts the ZIP and validates JavaScript syntax again.
- Writes a packaging report beside the ZIP.

## Command

```bash
./scripts/pack_user_extension_manual.sh
```

## Release Checklist

1. Confirm git revision with `git rev-parse --short HEAD`.
2. Run `find extension -name '*.js' -print0 | xargs -0 -n1 node --check`.
3. Run `./scripts/pack_user_extension_manual.sh`.
4. Load the generated ZIP/unpacked contents on desktop Chromium first.
5. Test the same package on Kiwi or Lemur Android.
6. If Android fails but admin/source package works, compare with backend automatic user package only after recording the failing URL, browser version, and console/network errors.

## Do Not

- Do not remove `sarathi_panel.js` without explicit approval.
- Do not rely on minified/hashed user output while debugging STALL runtime behavior.
- Do not package from stale generated artifacts.
- Do not change source behavior while only trying to create a user package.
