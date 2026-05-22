import tempfile
import unittest
import zipfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import FastAPI
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.api.admin_routes import settings as settings_routes
from app.api.admin_routes.settings import _extension_filename_for_format
from app.services.extension_service import ExtensionService


class ExtensionDownloadTests(unittest.TestCase):
    def test_package_extension_uses_latest_source_content(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            extension_dir = root / "extension"
            output_dir = root / "backend" / "app" / "static" / "extensions"
            extension_dir.mkdir(parents=True, exist_ok=True)
            (extension_dir / "manifest.json").write_text(
                '{"manifest_version": 3, "name": "Test Extension", "version": "1.0.0"}',
                encoding="utf-8",
            )

            src_file = extension_dir / "marker.txt"
            src_file.write_text("v1", encoding="utf-8")

            service = ExtensionService(root_dir=root, output_dir=output_dir)
            self.assertTrue(service.package_extension())

            zip_path = output_dir / "mcq_solver_extension.zip"
            self.assertTrue(zip_path.exists())
            with zipfile.ZipFile(zip_path, "r") as zf:
                self.assertEqual(zf.read("marker.txt").decode("utf-8"), "v1")

            src_file.write_text("v2", encoding="utf-8")
            self.assertTrue(service.package_extension())

            with zipfile.ZipFile(zip_path, "r") as zf:
                self.assertEqual(zf.read("marker.txt").decode("utf-8"), "v2")

    def test_package_extension_does_not_generate_user_artifacts(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            extension_dir = root / "extension"
            output_dir = root / "backend" / "app" / "static" / "extensions"
            extension_dir.mkdir(parents=True, exist_ok=True)
            (extension_dir / "manifest.json").write_text(
                '{"manifest_version": 3, "name": "Test Extension", "version": "1.0.0"}',
                encoding="utf-8",
            )

            service = ExtensionService(root_dir=root, output_dir=output_dir)
            self.assertTrue(service.package_extension())

            self.assertTrue((output_dir / "mcq_solver_extension.zip").exists())
            self.assertFalse((output_dir / "mcq_solver_extension_user.zip").exists())
            self.assertFalse((output_dir / "mcq_solver_extension_user.crx").exists())
            self.assertFalse((output_dir / "mcq_solver_extension_user.xpi").exists())

    def test_extension_format_mapping(self):
        self.assertEqual(_extension_filename_for_format("zip"), "mcq_solver_extension.zip")
        self.assertEqual(_extension_filename_for_format("CRX"), "mcq_solver_extension.crx")
        self.assertEqual(_extension_filename_for_format("xpi"), "mcq_solver_extension.xpi")
        self.assertEqual(_extension_filename_for_format("zip", "user"), "mcq_solver_extension_user.zip")
        self.assertEqual(_extension_filename_for_format("CRX", "user"), "mcq_solver_extension_user.crx")
        self.assertEqual(_extension_filename_for_format("xpi", "user"), "mcq_solver_extension_user.xpi")

    def test_extension_format_mapping_rejects_unknown_format(self):
        with self.assertRaises(HTTPException) as exc:
            _extension_filename_for_format("rar")
        self.assertEqual(exc.exception.status_code, 400)

    def test_package_extension_fails_when_source_folder_missing(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            output_dir = root / "backend" / "app" / "static" / "extensions"
            service = ExtensionService(root_dir=root, output_dir=output_dir)
            self.assertFalse(service.package_extension())

    def test_download_endpoint_routes_supported_formats(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            output_dir = root / "out"
            user_package_dir = root / "data" / "extension_packages"
            output_dir.mkdir(parents=True, exist_ok=True)
            user_package_dir.mkdir(parents=True, exist_ok=True)
            (output_dir / "mcq_solver_extension.zip").write_bytes(b"zip")
            (output_dir / "mcq_solver_extension.crx").write_bytes(b"crx")
            (output_dir / "mcq_solver_extension.xpi").write_bytes(b"xpi")
            (user_package_dir / "mcq_solver_extension_user.zip").write_bytes(b"user-zip")
            (user_package_dir / "mcq_solver_extension_user.crx").write_bytes(b"user-crx")
            (user_package_dir / "mcq_solver_extension_user.xpi").write_bytes(b"user-xpi")

            class DummyExtensionService:
                def __init__(self):
                    self.output_dir = output_dir
                    self.calls = 0

                def package_extension(self):
                    self.calls += 1
                    return True

            dummy = DummyExtensionService()
            app = FastAPI()
            app.include_router(settings_routes.router, prefix="/admin")
            app.state.container = SimpleNamespace(extension_service=dummy)

            with patch.object(settings_routes, "_admin_guard", return_value=None), \
                 patch.object(settings_routes, "_PROJECT_ROOT", root):
                client = TestClient(app)
                for fmt, expected_name in (
                    ("zip", "mcq_solver_extension.zip"),
                    ("crx", "mcq_solver_extension.crx"),
                    ("xpi", "mcq_solver_extension.xpi"),
                ):
                    resp = client.get(f"/admin/api/extension/download?format={fmt}")
                    self.assertEqual(resp.status_code, 200)
                    self.assertIn(expected_name, resp.headers.get("content-disposition", ""))
                for fmt, expected_name in (
                    ("zip", "mcq_solver_extension_user.zip"),
                    ("crx", "mcq_solver_extension_user.crx"),
                    ("xpi", "mcq_solver_extension_user.xpi"),
                ):
                    resp = client.get(f"/admin/api/extension/download?format={fmt}&variant=user")
                    self.assertEqual(resp.status_code, 200)
                    self.assertIn(expected_name, resp.headers.get("content-disposition", ""))

            self.assertEqual(dummy.calls, 3)

    def test_user_download_missing_prebuilt_package_returns_404(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            output_dir = root / "out"
            output_dir.mkdir(parents=True, exist_ok=True)

            class DummyExtensionService:
                def __init__(self):
                    self.output_dir = output_dir
                    self.calls = 0

                def package_extension(self):
                    self.calls += 1
                    return True

            dummy = DummyExtensionService()
            app = FastAPI()
            app.include_router(settings_routes.router, prefix="/admin")
            app.state.container = SimpleNamespace(extension_service=dummy)

            with patch.object(settings_routes, "_admin_guard", return_value=None), \
                 patch.object(settings_routes, "_PROJECT_ROOT", root):
                client = TestClient(app)
                resp = client.get("/admin/api/extension/download?format=zip&variant=user")
                self.assertEqual(resp.status_code, 404)

            self.assertEqual(dummy.calls, 0)

    def test_download_endpoint_rejects_unsupported_format(self):
        with tempfile.TemporaryDirectory() as tmp:
            output_dir = Path(tmp) / "out"
            output_dir.mkdir(parents=True, exist_ok=True)

            class DummyExtensionService:
                def __init__(self):
                    self.output_dir = output_dir
                    self.calls = 0

                def package_extension(self):
                    self.calls += 1
                    return True

            dummy = DummyExtensionService()
            app = FastAPI()
            app.include_router(settings_routes.router, prefix="/admin")
            app.state.container = SimpleNamespace(extension_service=dummy)

            with patch.object(settings_routes, "_admin_guard", return_value=None):
                client = TestClient(app)
                resp = client.get("/admin/api/extension/download?format=rar")
                self.assertEqual(resp.status_code, 400)
                resp = client.get("/admin/api/extension/download?format=zip&variant=public")
                self.assertEqual(resp.status_code, 400)

            self.assertEqual(dummy.calls, 0)


if __name__ == "__main__":
    unittest.main()
