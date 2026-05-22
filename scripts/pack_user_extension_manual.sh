#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_DIR="$ROOT_DIR/extension"
OUT_DIR="$ROOT_DIR/backend/app/static/extensions/manual"
REV="$(git -C "$ROOT_DIR" rev-parse --short HEAD 2>/dev/null || echo unknown)"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
PKG_NAME="mcq_solver_extension_user_manual_${REV}_${STAMP}"
WORK_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

[ -d "$SRC_DIR" ] || fail "extension source directory not found: $SRC_DIR"
[ -f "$SRC_DIR/manifest.json" ] || fail "manifest.json not found"
mkdir -p "$OUT_DIR"

cp -a "$SRC_DIR" "$WORK_DIR/extension"
find "$WORK_DIR/extension" -name '.DS_Store' -delete

node -e "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'))" "$WORK_DIR/extension/manifest.json"
node -e "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'))" "$WORK_DIR/extension/manifest_firefox.json"

find "$WORK_DIR/extension" -name '*.js' -print0 | xargs -0 -n1 node --check >/dev/null

node - "$WORK_DIR/extension" <<'NODE'
const fs = require('fs');
const path = require('path');
const root = process.argv[2];

function collectRefs(manifestName) {
  const manifestPath = path.join(root, manifestName);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const refs = [];
  if (manifest.background?.service_worker) refs.push(manifest.background.service_worker);
  for (const contentScript of manifest.content_scripts || []) {
    for (const js of contentScript.js || []) refs.push(js);
  }
  for (const group of manifest.web_accessible_resources || []) {
    for (const resource of group.resources || []) refs.push(resource);
  }
  return refs;
}

const htmlRefs = [];
for (const html of ['popup/popup.html', 'options/options.html']) {
  const file = path.join(root, html);
  if (!fs.existsSync(file)) continue;
  const text = fs.readFileSync(file, 'utf8');
  for (const match of text.matchAll(/src=["']([^"']+\.js)["']/g)) {
    htmlRefs.push(path.posix.join(path.posix.dirname(html), match[1]));
  }
}

const refs = [...collectRefs('manifest.json'), ...collectRefs('manifest_firefox.json'), ...htmlRefs];
const missing = refs.filter(ref => !fs.existsSync(path.join(root, ref)));
if (missing.length) {
  console.error('Missing packaged references:\n' + missing.join('\n'));
  process.exit(1);
}
console.log(`reference-check ok (${refs.length} refs)`);
NODE

python3 - "$WORK_DIR/extension" "$OUT_DIR/$PKG_NAME.zip" <<'PY'
from pathlib import Path
import sys
import zipfile

source = Path(sys.argv[1]).resolve()
target = Path(sys.argv[2]).resolve()
with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED) as archive:
    for path in sorted(source.rglob("*")):
        if path.is_file():
            archive.write(path, path.relative_to(source).as_posix())
print(target)
PY

CHECK_DIR="$WORK_DIR/check"
mkdir -p "$CHECK_DIR"
python3 -m zipfile -e "$OUT_DIR/$PKG_NAME.zip" "$CHECK_DIR"
find "$CHECK_DIR" -name '*.js' -print0 | xargs -0 -n1 node --check >/dev/null

cat > "$OUT_DIR/$PKG_NAME.report.txt" <<EOF
Manual user extension package
Generated: $STAMP UTC
Git revision: $REV
Source: $SRC_DIR
Package: $OUT_DIR/$PKG_NAME.zip

Packaging policy:
- Copied extension source as-is.
- Did not minify JavaScript.
- Did not hash or rename JavaScript files.
- Did not use backend ExtensionService automatic user packaging.
- Validated source manifests.
- Validated manifest, HTML, and web-accessible file references.
- Validated JavaScript syntax before and after ZIP extraction.

Critical files checked:
- extension/manifest.json
- extension/manifest_firefox.json
- extension/modules/sarathi_panel.js
- extension/modules/stall_automation.js
- extension/modules/vcam_inject.js
- extension/modules/vcam_controller.js
- extension/modules/sarathi_harden.js
EOF

echo "Manual user extension package created:"
echo "$OUT_DIR/$PKG_NAME.zip"
echo "$OUT_DIR/$PKG_NAME.report.txt"
