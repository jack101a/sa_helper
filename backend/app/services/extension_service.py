import shutil
import tempfile
from pathlib import Path
import logging

logger = logging.getLogger(__name__)

class ExtensionService:
    """Handles packaging and serving of browser extensions."""

    def __init__(self, root_dir: Path, output_dir: Path):
        self.extension_dir = root_dir / "extension"
        self.output_dir = output_dir

    def _prepare_source_dir(self) -> tempfile.TemporaryDirectory:
        """Copy source extension without transforming files."""
        tmp = tempfile.TemporaryDirectory(prefix="sa_helper_extension_")
        dist_dir = Path(tmp.name) / "extension"
        shutil.copytree(self.extension_dir, dist_dir)
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
        """Package the original/admin extension into ZIP, CRX, and XPI formats."""
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
            static_root_zip = self.output_dir.parent / "extension.zip"

            for artifact in (zip_path, crx_path, xpi_path, static_root_zip):
                artifact.unlink(missing_ok=True)

            logger.info(
                "Packaging extension",
                extra={"context": {"extension_dir": str(self.extension_dir), "zip_path": str(zip_path)}},
            )

            with self._prepare_source_dir() as tmp_dir:
                dist_dir = Path(tmp_dir) / "extension"
                if not self._write_archive_set(zip_base, zip_path, crx_path, xpi_path, dist_dir):
                    return False

            if not zip_path.exists():
                logger.error("Extension artifact was not created", extra={"context": {"zip_path": str(zip_path)}})
                return False

            shutil.copy2(zip_path, static_root_zip)

            logger.info(
                "Extension packaging successful",
                extra={"context": {
                    "zip_path": str(zip_path),
                    "crx_path": str(crx_path),
                    "xpi_path": str(xpi_path),
                }},
            )
            return True
        except Exception as e:
            logger.exception(
                "Failed to package extension",
                extra={"context": {"error": str(e), "extension_dir": str(self.extension_dir), "output_dir": str(self.output_dir)}},
            )
            return False
