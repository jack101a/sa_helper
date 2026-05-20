import shutil
from pathlib import Path
import logging

logger = logging.getLogger(__name__)

class ExtensionService:
    """Handles packaging and serving of browser extensions."""

    def __init__(self, root_dir: Path, output_dir: Path):
        self.extension_dir = root_dir / "extension"
        self.output_dir = output_dir
        
    def package_extension(self):
        """Packages the extension directory into ZIP, CRX, and XPI formats."""
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

            # 1. Create ZIP
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
            
            # shutil.make_archive adds the .zip extension automatically
            shutil.make_archive(str(zip_base), 'zip', self.extension_dir)
            if not zip_path.exists():
                logger.error("Extension ZIP was not created", extra={"context": {"zip_path": str(zip_path)}})
                return False
            
            # 2. Create CRX and XPI placeholders (copies of ZIP as per original script)
            shutil.copy2(zip_path, crx_path)
            shutil.copy2(zip_path, xpi_path)
            
            # Also copy to a root static folder if needed by legacy links
            shutil.copy2(zip_path, static_root_zip)

            logger.info(
                "Extension packaging successful",
                extra={"context": {"zip_path": str(zip_path), "crx_path": str(crx_path), "xpi_path": str(xpi_path)}},
            )
            return True
        except Exception as e:
            logger.exception(
                "Failed to package extension",
                extra={"context": {"error": str(e), "extension_dir": str(self.extension_dir), "output_dir": str(self.output_dir)}},
            )
            return False
