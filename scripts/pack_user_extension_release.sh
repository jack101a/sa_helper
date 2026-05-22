#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

python3 - "$ROOT_DIR" <<'PY'
from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(sys.argv[1]).resolve()
SRC_DIR = ROOT / "extension"
OUT_DIR = ROOT / "data" / "extension_packages"
PKG_BASE = "mcq_solver_extension_user"


def fail(message: str) -> None:
    print(f"ERROR: {message}", file=sys.stderr)
    raise SystemExit(1)


def run(cmd: list[str], **kwargs) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, check=True, text=True, capture_output=True, **kwargs)


def git_value(*args: str, default: str = "unknown") -> str:
    try:
        return run(["git", "-C", str(ROOT), *args]).stdout.strip() or default
    except Exception:
        return default


def resolve_esbuild() -> str:
    env_bin = os.environ.get("ESBUILD_BIN", "").strip()
    sys_bin = shutil.which("esbuild")
    candidates = [
        Path(env_bin) if env_bin else None,
        ROOT / "frontend" / "node_modules" / ".bin" / "esbuild",
        Path(sys_bin) if sys_bin else None,
    ]
    for candidate in candidates:
        if candidate and candidate.exists() and os.access(candidate, os.X_OK):
            return str(candidate)
    fail("esbuild not found. Install frontend dependencies or set ESBUILD_BIN.")


def node_check(js_path: Path) -> None:
    run(["node", "--check", str(js_path)])


def load_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        fail(f"invalid JSON in {path}: {exc}")


def minify_js(js_path: Path, esbuild: str) -> None:
    result = run([
        esbuild,
        str(js_path),
        "--minify",
        "--charset=utf8",
        "--legal-comments=none",
        "--log-level=error",
    ])
    js_path.write_text(result.stdout, encoding="utf-8")


def collect_manifest_refs(dist_dir: Path, manifest_name: str) -> list[str]:
    manifest = load_json(dist_dir / manifest_name)
    refs: list[str] = []
    background = manifest.get("background")
    if isinstance(background, dict) and background.get("service_worker"):
        refs.append(str(background["service_worker"]))
    for content_script in manifest.get("content_scripts") or []:
        if isinstance(content_script, dict):
            refs.extend(str(item) for item in content_script.get("js") or [])
    for group in manifest.get("web_accessible_resources") or []:
        if isinstance(group, dict):
            refs.extend(str(item) for item in group.get("resources") or [])
    return refs


def collect_html_refs(dist_dir: Path) -> list[str]:
    refs: list[str] = []
    for html_path in dist_dir.rglob("*.html"):
        rel_parent = html_path.parent.relative_to(dist_dir).as_posix()
        text = html_path.read_text(encoding="utf-8")
        for src in re.findall(r"src=[\"']([^\"']+\.js)[\"']", text):
            refs.append(Path(rel_parent, src).as_posix())
    return refs


def validate_refs(dist_dir: Path) -> int:
    refs: list[str] = []
    refs.extend(collect_manifest_refs(dist_dir, "manifest.json"))
    if (dist_dir / "manifest_firefox.json").exists():
        refs.extend(collect_manifest_refs(dist_dir, "manifest_firefox.json"))
    refs.extend(collect_html_refs(dist_dir))

    missing: list[str] = []
    for ref in refs:
        if "*" in ref:
            matches = list(dist_dir.glob(ref))
            if not matches:
                missing.append(ref)
            continue
        if not (dist_dir / ref).exists():
            missing.append(ref)
    if missing:
        fail("missing packaged references:\n" + "\n".join(missing))
    return len(refs)


def zip_dir(source: Path, target: Path) -> None:
    with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(source.rglob("*")):
            if path.is_file():
                archive.write(path, path.relative_to(source).as_posix())


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    if not SRC_DIR.is_dir():
        fail(f"extension source directory not found: {SRC_DIR}")
    if not (SRC_DIR / "manifest.json").is_file():
        fail("manifest.json not found")

    esbuild = resolve_esbuild()
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    for name in (
        f"{PKG_BASE}.zip",
        f"{PKG_BASE}.crx",
        f"{PKG_BASE}.xpi",
        f"{PKG_BASE}.SHA256SUMS",
        f"{PKG_BASE}.build.json",
        f"{PKG_BASE}.report.txt",
    ):
        (OUT_DIR / name).unlink(missing_ok=True)

    with tempfile.TemporaryDirectory(prefix="sa_helper_user_release_") as tmp:
        dist_dir = Path(tmp) / "extension"
        shutil.copytree(SRC_DIR, dist_dir)
        for path in dist_dir.rglob(".DS_Store"):
            path.unlink()

        load_json(dist_dir / "manifest.json")
        if (dist_dir / "manifest_firefox.json").exists():
            load_json(dist_dir / "manifest_firefox.json")
        for js_path in sorted(dist_dir.rglob("*.js")):
            node_check(js_path)

        for js_path in sorted(dist_dir.rglob("*.js")):
            minify_js(js_path, esbuild)
            node_check(js_path)

        ref_count = validate_refs(dist_dir)
        for js_path in sorted(dist_dir.rglob("*.js")):
            node_check(js_path)

        zip_path = OUT_DIR / f"{PKG_BASE}.zip"
        crx_path = OUT_DIR / f"{PKG_BASE}.crx"
        xpi_path = OUT_DIR / f"{PKG_BASE}.xpi"
        zip_dir(dist_dir, zip_path)
        shutil.copy2(zip_path, crx_path)
        shutil.copy2(zip_path, xpi_path)

        check_dir = Path(tmp) / "check"
        with zipfile.ZipFile(zip_path, "r") as archive:
            archive.extractall(check_dir)
        validate_refs(check_dir)
        for js_path in sorted(check_dir.rglob("*.js")):
            node_check(js_path)

    revision = git_value("rev-parse", "--short", "HEAD")
    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    artifacts = [OUT_DIR / f"{PKG_BASE}.{ext}" for ext in ("zip", "crx", "xpi")]
    sums = "\n".join(f"{sha256_file(path)}  {path.name}" for path in artifacts) + "\n"
    (OUT_DIR / f"{PKG_BASE}.SHA256SUMS").write_text(sums, encoding="utf-8")

    build_info = {
        "generated_at": timestamp,
        "git_revision": revision,
        "source": str(SRC_DIR),
        "output_dir": str(OUT_DIR),
        "package_base": PKG_BASE,
        "js_files_renamed": 0,
        "references_validated": ref_count,
        "minifier": esbuild,
        "protection": {
            "minified": True,
            "hashed_js_filenames": False,
            "sha256_checksums": True,
            "encrypted": False,
            "encryption_note": "Browser extension JavaScript cannot be truly encrypted because the browser must load executable code.",
        },
    }
    (OUT_DIR / f"{PKG_BASE}.build.json").write_text(json.dumps(build_info, indent=2), encoding="utf-8")

    report = f"""User extension release package
Generated: {timestamp}
Git revision: {revision}
Source: {SRC_DIR}
Output: {OUT_DIR}

Artifacts:
- {PKG_BASE}.zip
- {PKG_BASE}.crx
- {PKG_BASE}.xpi
- {PKG_BASE}.SHA256SUMS
- {PKG_BASE}.build.json

Packaging policy:
- Copied extension source into a temporary release directory.
- Preserved manifest, background, content, popup, options, and module filenames.
- Minified JavaScript with esbuild.
- Validated manifest JSON.
- Validated JavaScript syntax before and after minification.
- Validated manifest, HTML, and web-accessible-resource references before and after ZIP extraction.
- Wrote SHA256 checksums for release artifacts.
- Did not call backend ExtensionService automatic packaging.
- Did not place package artifacts in the Docker image.

Security note:
- This is minification plus checksum integrity, not real encryption.
- Real encryption is not practical for browser extension JS because browsers must execute readable code.
- Keep security controls in backend authentication, key entitlement, rate limits, and server-side logic.
"""
    (OUT_DIR / f"{PKG_BASE}.report.txt").write_text(report, encoding="utf-8")

    print("User extension release package created:")
    for path in artifacts:
        print(path)
    print(OUT_DIR / f"{PKG_BASE}.SHA256SUMS")
    print(OUT_DIR / f"{PKG_BASE}.build.json")
    print(OUT_DIR / f"{PKG_BASE}.report.txt")


if __name__ == "__main__":
    main()
PY
