# User Extension Packaging Workflow

This workflow separates debug packaging from release packaging.

## Why

The backend must not build the user extension automatically during admin downloads. User packages are manually prepared, verified, and placed in `data/extension_packages`, which should be mounted as Docker volume data. The Docker image should not contain the generated user package.

The original/admin extension download stays source-based and can still be rebuilt by the backend. The user extension download serves only prebuilt files:

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

Use `scripts/pack_user_extension_release.sh` for distribution.

The release script:

- Copies `extension/` into a temporary build directory.
- Validates `manifest.json` and `manifest_firefox.json`.
- Validates every JavaScript file with `node --check` before transformation.
- Preserves manifest, background, content, popup, options, and module filenames.
- Minifies JavaScript with `esbuild` without filename hashing or renaming.
- Validates JavaScript syntax again after minification.
- Validates packaged references before final output and after ZIP extraction.
- Creates ZIP, CRX, and XPI artifacts under `data/extension_packages/`.
- Writes `mcq_solver_extension_user.SHA256SUMS`, `mcq_solver_extension_user.build.json`, and `mcq_solver_extension_user.report.txt`.
- Does not call backend `ExtensionService.package_extension()`.
- Does not write the user package into `backend/app/static/extensions/`.
- Does not place generated user artifacts in the Docker image.

Command:

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
3. Run `./scripts/pack_user_extension_release.sh`.
4. Verify `data/extension_packages/mcq_solver_extension_user.SHA256SUMS`.
5. Load the generated ZIP/unpacked contents on desktop Chromium first.
6. Test the same package on Kiwi or Lemur Android.
7. If Android fails but admin/source package works, run `./scripts/pack_user_extension_manual.sh` and compare behavior before changing source code.

## Do Not

- Do not remove `sarathi_panel.js` without explicit approval.
- Do not introduce hashed/renamed JavaScript entrypoints until the stable-minified package is proven on Kiwi/Lemur.
- Do not package from stale generated artifacts.
- Do not change source behavior while only trying to create a user package.
- Do not reintroduce backend automatic user package building.
