# User Extension Packaging Workflow

This workflow separates on-demand release packaging from debug packaging.

## Why

The backend builds the user extension automatically when an admin downloads `variant=user`. The generated package is still written to `data/extension_packages`, but admins do not need to copy files there manually.

The original/admin extension download stays source-based and is rebuilt by the backend. The user extension download runs `scripts/pack_user_extension_release.sh` first, then serves:

- `data/extension_packages/mcq_solver_extension_user.zip`
- `data/extension_packages/mcq_solver_extension_user.crx`
- `data/extension_packages/mcq_solver_extension_user.xpi`

## Current Source Analysis

At commit `08e4cb3` and later, the source extension has:

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

## Release Packaging Policy

Use `scripts/pack_user_extension_release.sh` for distribution. The admin download endpoint runs this script automatically for user packages:

```text
/admin/api/extension/download?format=zip&variant=user
/admin/api/extension/download?format=crx&variant=user
/admin/api/extension/download?format=xpi&variant=user
```

The release script:

- Copies `extension/` into a temporary build directory.
- Applies a user-only release profile in that temporary directory.
- Removes `options_page` and excludes the `options/` directory from the user package.
- Replaces the combined admin/user popup with a user-only popup.
- Validates `manifest.json` and `manifest_firefox.json`.
- Validates every JavaScript file with `node --check` before transformation.
- Renames module JavaScript files to deterministic coded filenames such as `Apollo.js`, `Poseidon.js`, and `Zeus.js`.
- Rewrites manifest, HTML, and JavaScript file references to the coded module filenames.
- Minifies JavaScript with `esbuild` without filename hashing or renaming.
- Validates JavaScript syntax again after minification.
- Validates packaged references before final output and after ZIP extraction.
- Validates that the packaged user popup does not contain admin controls.
- Creates ZIP, CRX, and XPI artifacts under `data/extension_packages/`.
- Writes `mcq_solver_extension_user.SHA256SUMS`, `mcq_solver_extension_user.build.json`, and `mcq_solver_extension_user.report.txt`.
- Is called by backend `ExtensionService.package_user_extension()` during user package download.
- Does not write the user package into `backend/app/static/extensions/`.
- Does not place generated user artifacts in the Docker image.

Manual command for local verification:

```bash
./scripts/pack_user_extension_release.sh
```

Security note:

- This is minification and checksum integrity.
- It is not true encryption. Browser extension JavaScript cannot be truly encrypted because the browser must load executable code.
- Keep sensitive logic, entitlement checks, learning data, and privileged decisions server-side.

## Debug Packaging Policy

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

Debug command:

```bash
./scripts/pack_user_extension_manual.sh
```

## Release Checklist

1. Confirm git revision with `git rev-parse --short HEAD`.
2. Run `find extension -name '*.js' -print0 | xargs -0 -n1 node --check`.
3. Download `/admin/api/extension/download?format=zip&variant=user`, or run `./scripts/pack_user_extension_release.sh` manually for local verification.
4. Verify `data/extension_packages/mcq_solver_extension_user.SHA256SUMS`.
5. Load the generated ZIP/unpacked contents on desktop Chromium first.
6. Test the same package on Kiwi or Lemur Android.
7. If Android fails but admin/source package works, run `./scripts/pack_user_extension_manual.sh` and compare behavior before changing source code.

## Do Not

- Do not remove `sarathi_panel.js` without explicit approval.
- Do not rename files directly inside `extension/`; user filename coding belongs in the release packaging transform.
- Do not package from stale generated artifacts.
- Do not change source behavior while only trying to create a user package.
- Do not bypass the release packer when serving user downloads.
