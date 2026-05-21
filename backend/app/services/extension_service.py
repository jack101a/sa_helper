import shutil
import tempfile
import hashlib
import json
import os
import re
import subprocess
from pathlib import Path
import logging

from rjsmin import jsmin

logger = logging.getLogger(__name__)

class ExtensionService:
    """Handles packaging and serving of browser extensions."""

    def __init__(self, root_dir: Path, output_dir: Path):
        self.extension_dir = root_dir / "extension"
        self.output_dir = output_dir
        self._root_dir = root_dir

    def _resolve_esbuild_bin(self) -> Path | None:
        """Resolve an esbuild executable for stronger user-package minification."""
        from shutil import which

        env_bin = os.getenv("ESBUILD_BIN", "").strip()
        if env_bin:
            p = Path(env_bin)
            if p.exists() and os.access(p, os.X_OK):
                return p

        local_bin = self._root_dir / "frontend" / "node_modules" / ".bin" / "esbuild"
        if local_bin.exists() and os.access(local_bin, os.X_OK):
            return local_bin

        sys_bin = which("esbuild")
        if sys_bin:
            return Path(sys_bin)
        return None

    def _minify_user_js(self, js_path: Path, esbuild_bin: Path | None) -> bool:
        """Minify JS for user package; prefer esbuild, fallback to rjsmin."""
        original = js_path.read_text(encoding="utf-8")
        if esbuild_bin is not None:
            try:
                result = subprocess.run(
                    [
                        str(esbuild_bin),
                        str(js_path),
                        "--minify",
                        "--charset=utf8",
                        "--legal-comments=none",
                        "--log-level=error",
                    ],
                    check=True,
                    capture_output=True,
                    text=True,
                )
                js_path.write_text(result.stdout, encoding="utf-8")
                return True
            except Exception as exc:
                logger.warning(
                    "esbuild_minify_failed_fallback_rjsmin",
                    extra={"context": {"file": str(js_path), "error": str(exc)}},
                )
        transformed = jsmin(original, keep_bang_comments=False)
        js_path.write_text(transformed, encoding="utf-8")
        return False

    def _prepare_source_dir(self) -> tempfile.TemporaryDirectory:
        """Copy source extension without transforming files."""
        tmp = tempfile.TemporaryDirectory(prefix="sa_helper_extension_")
        dist_dir = Path(tmp.name) / "extension"
        shutil.copytree(self.extension_dir, dist_dir)
        return tmp

    def _js_filename_map(self, dist_dir: Path) -> dict[str, str]:
        """Build deterministic hashed JS filenames for the packaged copy."""
        mapping: dict[str, str] = {}
        for js_path in sorted(dist_dir.rglob("*.js")):
            rel = js_path.relative_to(dist_dir).as_posix()
            digest = hashlib.sha256(rel.encode("utf-8") + b"\0" + js_path.read_bytes()).hexdigest()[:10]
            mapping[rel] = js_path.with_name(f"{js_path.stem}.{digest}.js").relative_to(dist_dir).as_posix()
        return mapping

    def _rewrite_manifest_refs(self, manifest_path: Path, mapping: dict[str, str]) -> None:
        if not manifest_path.exists():
            return
        data = json.loads(manifest_path.read_text(encoding="utf-8"))

        def rewrite(value):
            if isinstance(value, str):
                return mapping.get(value, value)
            if isinstance(value, list):
                return [rewrite(item) for item in value]
            if isinstance(value, dict):
                return {key: rewrite(item) for key, item in value.items()}
            return value

        manifest_path.write_text(json.dumps(rewrite(data), indent=2), encoding="utf-8")

    def _rewrite_html_refs(self, dist_dir: Path, html_path: Path, mapping: dict[str, str]) -> None:
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

        updated = re.sub(r"src=(['\"])([^'\"]+\.js)\1", replace_src, content)
        html_path.write_text(updated, encoding="utf-8")

    def _rewrite_js_string_refs(self, js_path: Path, mapping: dict[str, str], basename_map: dict[str, str]) -> None:
        content = js_path.read_text(encoding="utf-8")
        for old, new in sorted(mapping.items(), key=lambda item: len(item[0]), reverse=True):
            content = content.replace(old, new)
        for old_name, new_name in basename_map.items():
            content = content.replace(old_name, new_name)
        js_path.write_text(content, encoding="utf-8")

    def _prepare_user_distribution_dir(self) -> tempfile.TemporaryDirectory:
        """Copy source extension, rewrite JS filenames, and minify the temporary copy."""
        tmp = tempfile.TemporaryDirectory(prefix="sa_helper_extension_user_")
        dist_dir = Path(tmp.name) / "extension"
        shutil.copytree(self.extension_dir, dist_dir)

        mapping = self._js_filename_map(dist_dir)
        name_counts: dict[str, int] = {}
        for old in mapping:
            old_name = Path(old).name
            name_counts[old_name] = name_counts.get(old_name, 0) + 1
        basename_map = {
            Path(old).name: Path(new).name
            for old, new in mapping.items()
            if name_counts.get(Path(old).name, 0) == 1
        }

        self._rewrite_manifest_refs(dist_dir / "manifest.json", mapping)
        self._rewrite_manifest_refs(dist_dir / "manifest_firefox.json", mapping)
        for html_path in dist_dir.rglob("*.html"):
            self._rewrite_html_refs(dist_dir, html_path, mapping)
        for js_path in dist_dir.rglob("*.js"):
            self._rewrite_js_string_refs(js_path, mapping, basename_map)

        esbuild_bin = self._resolve_esbuild_bin()
        minified = 0
        esbuild_minified = 0
        for js_path in dist_dir.rglob("*.js"):
            used_esbuild = self._minify_user_js(js_path, esbuild_bin)
            minified += 1
            if used_esbuild:
                esbuild_minified += 1

        for old, new in sorted(mapping.items(), key=lambda item: len(item[0]), reverse=True):
            old_path = dist_dir / old
            new_path = dist_dir / new
            old_path.rename(new_path)

        logger.info(
            "User extension distribution prepared",
            extra={"context": {
                "dist_dir": str(dist_dir),
                "js_files_minified": minified,
                "js_files_minified_esbuild": esbuild_minified,
                "js_files_renamed": len(mapping),
                "esbuild_bin": str(esbuild_bin) if esbuild_bin else "",
            }},
        )
        return tmp

    def _write_archive_set(self, zip_base: Path, zip_path: Path, crx_path: Path, xpi_path: Path, source_dir: Path) -> bool:
        shutil.make_archive(str(zip_base), "zip", source_dir)
        if not zip_path.exists():
            logger.error("Extension ZIP was not created", extra={"context": {"zip_path": str(zip_path)}})
            return False
        shutil.copy2(zip_path, crx_path)
        shutil.copy2(zip_path, xpi_path)
        return True
        
    def package_extension(self):
        """Package source and user distribution extensions into ZIP, CRX, and XPI formats."""
        try:
            if not self.extension_dir.exists():
                logger.error(
                    "Extension source directory not found",
                    extra={"context": {"extension_dir": str(self.extension_dir), "output_dir": str(self.output_dir)}},
                )
                return False
            manifest_path = self.extension_dir / "manifest.json"
            if not manifest_path.exists():
                logger.error(
                    "Extension manifest not found",
                    extra={"context": {"manifest_path": str(manifest_path), "extension_dir": str(self.extension_dir)}},
                )
                return False

            self.output_dir.mkdir(parents=True, exist_ok=True)

            zip_base = self.output_dir / "mcq_solver_extension"
            zip_path = self.output_dir / "mcq_solver_extension.zip"
            crx_path = self.output_dir / "mcq_solver_extension.crx"
            xpi_path = self.output_dir / "mcq_solver_extension.xpi"
            user_zip_base = self.output_dir / "mcq_solver_extension_user"
            user_zip_path = self.output_dir / "mcq_solver_extension_user.zip"
            user_crx_path = self.output_dir / "mcq_solver_extension_user.crx"
            user_xpi_path = self.output_dir / "mcq_solver_extension_user.xpi"
            static_root_zip = self.output_dir.parent / "extension.zip"

            for artifact in (zip_path, crx_path, xpi_path, user_zip_path, user_crx_path, user_xpi_path, static_root_zip):
                artifact.unlink(missing_ok=True)

            logger.info(
                "Packaging extension",
                extra={"context": {"extension_dir": str(self.extension_dir), "zip_path": str(zip_path)}},
            )

            with self._prepare_source_dir() as tmp_dir:
                dist_dir = Path(tmp_dir) / "extension"
                if not self._write_archive_set(zip_base, zip_path, crx_path, xpi_path, dist_dir):
                    return False

            with self._prepare_user_distribution_dir() as tmp_dir:
                dist_dir = Path(tmp_dir) / "extension"
                if not self._write_archive_set(user_zip_base, user_zip_path, user_crx_path, user_xpi_path, dist_dir):
                    return False

            if not zip_path.exists() or not user_zip_path.exists():
                logger.error("Extension artifact was not created", extra={"context": {"zip_path": str(zip_path), "user_zip_path": str(user_zip_path)}})
                return False

            shutil.copy2(zip_path, static_root_zip)

            logger.info(
                "Extension packaging successful",
                extra={"context": {
                    "zip_path": str(zip_path),
                    "crx_path": str(crx_path),
                    "xpi_path": str(xpi_path),
                    "user_zip_path": str(user_zip_path),
                    "user_crx_path": str(user_crx_path),
                    "user_xpi_path": str(user_xpi_path),
                }},
            )
            return True
        except Exception as e:
            logger.exception(
                "Failed to package extension",
                extra={"context": {"error": str(e), "extension_dir": str(self.extension_dir), "output_dir": str(self.output_dir)}},
            )
            return False
