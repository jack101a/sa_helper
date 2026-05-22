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


def write_json(path: Path, data: dict) -> None:
    path.write_text(json.dumps(data, indent=2), encoding="utf-8")


def js_filename_map(dist_dir: Path) -> dict[str, str]:
    mapping: dict[str, str] = {}
    for js_path in sorted(dist_dir.rglob("*.js")):
        rel = js_path.relative_to(dist_dir).as_posix()
        digest = hashlib.sha256(rel.encode("utf-8") + b"\0" + js_path.read_bytes()).hexdigest()[:10]
        mapping[rel] = js_path.with_name(f"{js_path.stem}.{digest}.js").relative_to(dist_dir).as_posix()
    return mapping


def rewrite_manifest_refs(manifest_path: Path, mapping: dict[str, str]) -> None:
    if not manifest_path.exists():
        return
    data = load_json(manifest_path)

    def rewrite(value):
        if isinstance(value, str):
            return mapping.get(value, value)
        if isinstance(value, list):
            return [rewrite(item) for item in value]
        if isinstance(value, dict):
            return {key: rewrite(item) for key, item in value.items()}
        return value

    write_json(manifest_path, rewrite(data))


def rewrite_html_refs(dist_dir: Path, html_path: Path, mapping: dict[str, str]) -> None:
    content = html_path.read_text(encoding="utf-8")

    def replace_src(match: re.Match) -> str:
        quote = match.group(1)
        src = match.group(2)
        if not src.endswith(".js"):
            return match.group(0)
        target = (html_path.parent / src).resolve()
        try:
            rel = target.relative_to(dist_dir.resolve()).as_posix()
        except ValueError:
            return match.group(0)
        mapped = mapping.get(rel)
        if not mapped:
            return match.group(0)
        new_src = os.path.relpath(dist_dir / mapped, html_path.parent).replace(os.sep, "/")
        return f"src={quote}{new_src}{quote}"

    html_path.write_text(re.sub(r"src=(['\"])([^'\"]+\.js)\1", replace_src, content), encoding="utf-8")


def rewrite_js_string_refs(js_path: Path, mapping: dict[str, str], basename_map: dict[str, str]) -> None:
    content = js_path.read_text(encoding="utf-8")
    for old, new in sorted(mapping.items(), key=lambda item: len(item[0]), reverse=True):
        content = content.replace(old, new)
    for old_name, new_name in basename_map.items():
        content = content.replace(old_name, new_name)
    js_path.write_text(content, encoding="utf-8")


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
        for match in re.finditer(r"src=[\"']([^\"']+\.js)[\"']", text):
            refs.append(Path(rel_parent, match.group(1)).as_posix())
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

        mapping = js_filename_map(dist_dir)
        name_counts: dict[str, int] = {}
        for old in mapping:
            old_name = Path(old).name
            name_counts[old_name] = name_counts.get(old_name, 0) + 1
        basename_map = {
            Path(old).name: Path(new).name
            for old, new in mapping.items()
            if name_counts.get(Path(old).name, 0) == 1
        }

        rewrite_manifest_refs(dist_dir / "manifest.json", mapping)
        rewrite_manifest_refs(dist_dir / "manifest_firefox.json", mapping)
        for html_path in sorted(dist_dir.rglob("*.html")):
            rewrite_html_refs(dist_dir, html_path, mapping)
        for js_path in sorted(dist_dir.rglob("*.js")):
            rewrite_js_string_refs(js_path, mapping, basename_map)
            minify_js(js_path, esbuild)
            node_check(js_path)

        for old, new in sorted(mapping.items(), key=lambda item: len(item[0]), reverse=True):
            old_path = dist_dir / old
            new_path = dist_dir / new
            new_path.parent.mkdir(parents=True, exist_ok=True)
            old_path.rename(new_path)

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
        "js_files_renamed": len(mapping),
        "references_validated": ref_count,
        "minifier": esbuild,
        "protection": {
            "minified": True,
            "hashed_js_filenames": True,
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
- Rewrote JavaScript references in manifest, HTML, and JS string references.
- Renamed JavaScript files to deterministic SHA256-content hashed filenames.
- Minified JavaScript with esbuild.
- Validated manifest JSON.
- Validated JavaScript syntax before and after transformation.
- Validated manifest, HTML, and web-accessible-resource references before final output.
- Wrote SHA256 checksums for release artifacts.
- Did not call backend ExtensionService automatic packaging.
- Did not place package artifacts in the Docker image.

Security note:
- This is minification plus filename hashing and checksum integrity, not real encryption.
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
