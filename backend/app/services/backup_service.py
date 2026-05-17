"""Backup and restore service - portable system/user backup packages."""

from __future__ import annotations

import base64
import hashlib
import hmac
import io
import json
import logging
import os
import shutil
import sqlite3
import time
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlencode

import httpx
from sqlalchemy import delete, inspect, insert, select

from app.core.config import Settings
from app.core.db import Base, get_engine, get_session
from app.core.paths import get_project_root

logger = logging.getLogger(__name__)

BACKUP_VERSION = 1
TELEGRAM_UPLOAD_LIMIT_BYTES = 45 * 1024 * 1024
TELEGRAM_HOSTED_API_BASE_URL = "https://api.telegram.org"
SYSTEM_FILE_ROOTS = [
    "data/models",
    "data/mappings",
    "data/userscripts",
    "data/automation_scripts",
    "data/hashes",
    "data/questions",
    "backend/tessdata",
]
USER_TABLES = [
    "users",
    "subscription_plans",
    "user_subscriptions",
    "payment_records",
    "user_api_keys",
    "user_api_key_devices",
    "usage_cycles",
    "audit_logs",
    "api_keys",
    "api_key_allowed_domains",
    "api_key_rate_limits",
    "api_key_device_bindings",
    "usage_events",
]


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _json_bytes(data: Any) -> bytes:
    return json.dumps(data, ensure_ascii=False, indent=2, default=str).encode("utf-8")


def _xor_stream(data: bytes, key: str) -> bytes:
    """Encrypt/decrypt with an HMAC-derived stream using stdlib only."""
    if not key:
        return data
    secret = key.encode("utf-8")
    out = bytearray()
    counter = 0
    while len(out) < len(data):
        out.extend(hmac.new(secret, counter.to_bytes(8, "big"), hashlib.sha256).digest())
        counter += 1
    return bytes(a ^ b for a, b in zip(data, out))


class BackupService:
    """Manages local packages, restore validation, Telegram, and Google Drive upload."""

    def __init__(self, settings: Settings):
        self._settings = settings
        self._root = get_project_root()
        self._db_path = Path(settings.storage.sqlite_path)
        self._backup_dir = self._root / "backend" / "backups"
        self._backup_dir.mkdir(parents=True, exist_ok=True)

    def full_backup(self) -> dict:
        started = datetime.now(timezone.utc)
        backup_id = f"backup_{started.strftime('%Y%m%d_%H%M%S')}"
        result = {
            "backup_id": backup_id,
            "type": "full-package",
            "started_at": started.isoformat(),
            "status": "running",
        }
        try:
            package = self.create_package(backup_id=backup_id)
            result.update({
                "status": "completed",
                "finished_at": datetime.now(timezone.utc).isoformat(),
                "file_path_or_uri": str(package["path"]),
                "checksum": package["checksum"],
                "size_bytes": package["size_bytes"],
                "encrypted": package["encrypted"],
            })
            self._cleanup_old_backups(self._retention_count())
            self._log_backup_run(result)
            self.notify_telegram_backup(result)
            if self._truthy_setting("backup.gdrive.enabled"):
                self.upload_to_gdrive(Path(package["path"]))
            return result
        except Exception as exc:
            result["status"] = "failed"
            result["error"] = str(exc)
            self._log_backup_run(result)
            self.notify_telegram_backup(result)
            logger.exception("backup_failed", extra={"context": result})
            return result

    def create_package(self, backup_id: str | None = None) -> dict:
        created = datetime.now(timezone.utc)
        backup_id = backup_id or f"backup_{created.strftime('%Y%m%d_%H%M%S')}"
        payload = self._build_payload(backup_id, created)
        clear_bytes = self._zip_payload(payload)
        encryption_key = self._backup_encryption_key()
        stored_bytes = _xor_stream(clear_bytes, encryption_key)
        suffix = ".upbak" if encryption_key else ".zip"
        package_path = self._backup_dir / f"{backup_id}{suffix}"
        package_path.write_bytes(stored_bytes)
        return {
            "backup_id": backup_id,
            "path": package_path,
            "checksum": _sha256(stored_bytes),
            "size_bytes": package_path.stat().st_size,
            "encrypted": bool(encryption_key),
        }

    def validate_package(self, package_path: str | Path) -> dict:
        package = Path(package_path)
        clear_bytes = self._read_package_bytes(package)
        with zipfile.ZipFile(io.BytesIO(clear_bytes)) as zf:
            manifest = json.loads(zf.read("manifest.json").decode("utf-8"))
            for name, expected in manifest.get("checksums", {}).items():
                actual = _sha256(zf.read(name))
                if actual != expected:
                    return {"ok": False, "error": f"checksum mismatch: {name}"}
        return {"ok": True, "manifest": manifest}

    def restore_from_backup(self, backup_id: str) -> dict:
        candidates = [self._backup_dir / backup_id]
        if not Path(backup_id).suffix:
            candidates += [self._backup_dir / f"{backup_id}.upbak", self._backup_dir / f"{backup_id}.zip"]
        package = next((item for item in candidates if item.exists()), None)
        if not package:
            return {"status": "failed", "error": f"Backup {backup_id} not found"}
        return self.restore_package(package)

    def restore_package(self, package_path: str | Path) -> dict:
        package = Path(package_path)
        try:
            validation = self.validate_package(package)
            if not validation.get("ok"):
                return {"status": "failed", "error": validation.get("error")}
            clear_bytes = self._read_package_bytes(package)
            with zipfile.ZipFile(io.BytesIO(clear_bytes)) as zf:
                system_data = json.loads(zf.read("system-data.json").decode("utf-8"))
                user_data = json.loads(zf.read("user-data.json").decode("utf-8"))
                self._restore_system_data(system_data)
                self._restore_user_data(user_data)
                self._restore_files(zf)
            return {"status": "completed", "backup": str(package), "manifest": validation["manifest"]}
        except Exception as exc:
            logger.exception("restore_failed", extra={"context": {"error": str(exc)}})
            return {"status": "failed", "error": str(exc)}

    def import_system_bundle(self, package_path: str | Path) -> dict:
        package = Path(package_path)
        try:
            validation = self.validate_package(package)
            if not validation.get("ok"):
                return {"status": "failed", "error": validation.get("error")}
            clear_bytes = self._read_package_bytes(package)
            with zipfile.ZipFile(io.BytesIO(clear_bytes)) as zf:
                names = set(zf.namelist())
                if "system-data.json" in names:
                    system_data = json.loads(zf.read("system-data.json").decode("utf-8"))
                    if system_data:
                        self._restore_system_data(system_data)
                self._restore_files(zf)
            manifest = validation["manifest"]
            return {
                "status": "completed",
                "bundle": str(package),
                "file_count": int(manifest.get("file_count") or 0),
                "manifest": manifest,
            }
        except Exception as exc:
            logger.exception("system_bundle_import_failed", extra={"context": {"error": str(exc)}})
            return {"status": "failed", "error": str(exc)}

    def list_backups(self) -> list[dict]:
        backups = []
        for item in sorted(self._backup_dir.glob("backup_*.*"), key=lambda p: p.stat().st_mtime, reverse=True):
            if item.suffix not in {".upbak", ".zip"}:
                continue
            backups.append({
                "id": item.stem,
                "name": item.name,
                "created": datetime.fromtimestamp(item.stat().st_mtime, tz=timezone.utc).isoformat(),
                "size_bytes": item.stat().st_size,
                "path": str(item),
                "encrypted": item.suffix == ".upbak",
            })
        return backups

    def get_backup_health(self) -> dict:
        backups = self.list_backups()
        gdrive_token = self._gdrive_token_data()
        return {
            "total_backups": len(backups),
            "last_backup": backups[0] if backups else None,
            "backup_dir": str(self._backup_dir),
            "db_type": self._settings.storage.db_type,
            "telegram_channel_set": bool(self._setting("backup.telegram_channel_id")),
            "telegram_token_set": bool(self._telegram_token()),
            "telegram_api_base_url": self._telegram_api_base_url(),
            "telegram_local_api": self._telegram_uses_local_api(),
            "telegram_last_error": self._setting("backup.telegram_last_error"),
            "gdrive_enabled": self._truthy_setting("backup.gdrive.enabled"),
            "gdrive_client_configured": bool(self._gdrive_client_id() and self._gdrive_client_secret()),
            "gdrive_connected": bool(gdrive_token.get("refresh_token") or gdrive_token.get("access_token")),
            "gdrive_folder_id_set": bool(self._setting("backup.gdrive.folder_id")),
            "gdrive_last_error": self._setting("backup.gdrive.last_error"),
            "gdrive_last_file_id": self._setting("backup.gdrive.last_file_id"),
        }

    def notify_telegram_backup(self, result: dict) -> bool:
        token = self._telegram_token()
        channel_id = self._setting("backup.telegram_channel_id")
        if not token or not channel_id:
            return False
        status = result.get("status")
        path = result.get("file_path_or_uri")
        package = Path(path) if path else None
        delivery = "message only"
        if (
            package
            and package.exists()
            and package.stat().st_size > TELEGRAM_UPLOAD_LIMIT_BYTES
            and not self._telegram_uses_local_api()
        ):
            parts = (package.stat().st_size + TELEGRAM_UPLOAD_LIMIT_BYTES - 1) // TELEGRAM_UPLOAD_LIMIT_BYTES
            delivery = f"{parts} numbered file parts"
        elif package and package.exists():
            delivery = "single document via local Bot API" if self._telegram_uses_local_api() else "single document"
        text = (
            f"Backup {status}\n"
            f"ID: {result.get('backup_id')}\n"
            f"Size: {result.get('size_bytes', 0)} bytes\n"
            f"Checksum: {result.get('checksum', 'n/a')}\n"
            f"Delivery: {delivery}\n"
            "Restore: deploy container, upload this package in admin, validate, restore."
        )
        try:
            self._telegram_post(token, "sendMessage", data={"chat_id": channel_id, "text": text})
            if package and package.exists():
                self._send_telegram_package(token, channel_id, package, result)
            self._set_setting("backup.telegram_last_error", "")
            return True
        except Exception as exc:
            self._set_setting("backup.telegram_last_error", str(exc))
            logger.warning("backup_telegram_notify_failed", extra={"context": {"error": str(exc)}})
            return False

    def test_telegram_destination(self, chat_id: str | None = None, text: str | None = None) -> dict:
        token = self._telegram_token()
        target = (chat_id or self._setting("backup.telegram_channel_id")).strip()
        if not token:
            return {"ok": False, "error": "TELEGRAM_BOT_TOKEN or telegram.bot_token is not configured"}
        if not target:
            return {"ok": False, "error": "backup.telegram_channel_id is not configured"}
        message = text or f"SA Helper backup test message\nUTC: {datetime.now(timezone.utc).isoformat()}"
        try:
            payload = self._telegram_post(token, "sendMessage", data={"chat_id": target, "text": message})
            self._set_setting("backup.telegram_last_error", "")
            return {"ok": True, "chat_id": target, "message_id": payload.get("result", {}).get("message_id")}
        except Exception as exc:
            error = str(exc)
            self._set_setting("backup.telegram_last_error", error)
            logger.warning("backup_telegram_test_failed", extra={"context": {"error": error, "chat_id": target}})
            return {"ok": False, "chat_id": target, "error": error, "hint": self._telegram_error_hint(error)}

    def gdrive_auth_url(self, redirect_uri: str) -> dict:
        client_id = self._gdrive_client_id()
        if not client_id:
            return {"ok": False, "error": "Google Drive OAuth client is not configured (set GOOGLE_DRIVE_CLIENT_ID or backup.gdrive.client_id)"}
        params = {
            "client_id": client_id,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": "https://www.googleapis.com/auth/drive.file",
            "access_type": "offline",
            "prompt": "consent",
        }
        return {"ok": True, "url": "https://accounts.google.com/o/oauth2/v2/auth?" + urlencode(params)}

    async def gdrive_exchange_code(self, code: str, redirect_uri: str) -> dict:
        client_id = self._gdrive_client_id()
        client_secret = self._gdrive_client_secret()
        if not client_id or not client_secret:
            return {"ok": False, "error": "Google Drive OAuth client is not configured (set GOOGLE_DRIVE_CLIENT_ID/GOOGLE_DRIVE_CLIENT_SECRET)"}
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post("https://oauth2.googleapis.com/token", data={
                "code": code,
                "client_id": client_id,
                "client_secret": client_secret,
                "redirect_uri": redirect_uri,
                "grant_type": "authorization_code",
            })
        if resp.status_code >= 400:
            self._set_setting("backup.gdrive.last_error", resp.text)
            return {"ok": False, "error": resp.text}
        data = resp.json()
        existing = self._gdrive_token_data()
        if "refresh_token" not in data and existing.get("refresh_token"):
            data["refresh_token"] = existing["refresh_token"]
        if data.get("expires_in"):
            data["expires_at"] = int(time.time()) + int(data["expires_in"])
        self._save_gdrive_token_data(data)
        self._set_setting("backup.gdrive.enabled", "true")
        return {"ok": True, "expires_in": data.get("expires_in")}

    def upload_to_gdrive(self, package_path: Path) -> dict:
        token = self._gdrive_access_token()
        if not token:
            return {"ok": False, "error": "Google Drive is not connected"}
        metadata = {"name": package_path.name}
        folder_id = self._setting("backup.gdrive.folder_id")
        if folder_id:
            metadata["parents"] = [folder_id]
        try:
            init_resp = httpx.post(
                "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable",
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json; charset=UTF-8",
                    "X-Upload-Content-Type": "application/octet-stream",
                    "X-Upload-Content-Length": str(package_path.stat().st_size),
                },
                content=json.dumps(metadata).encode("utf-8"),
                timeout=30,
            )
            if init_resp.status_code >= 400:
                self._set_setting("backup.gdrive.last_error", init_resp.text)
                return {"ok": False, "error": init_resp.text}
            upload_url = init_resp.headers.get("Location")
            if not upload_url:
                error = "Google Drive did not return a resumable upload URL"
                self._set_setting("backup.gdrive.last_error", error)
                return {"ok": False, "error": error}
            with package_path.open("rb") as fh:
                upload_resp = httpx.put(
                    upload_url,
                    headers={
                        "Content-Type": "application/octet-stream",
                        "Content-Length": str(package_path.stat().st_size),
                    },
                    content=fh,
                    timeout=300,
                )
            if upload_resp.status_code >= 400:
                self._set_setting("backup.gdrive.last_error", upload_resp.text)
                return {"ok": False, "error": upload_resp.text}
            data = upload_resp.json()
            self._set_setting("backup.gdrive.last_file_id", data.get("id", ""))
            self._set_setting("backup.gdrive.last_error", "")
            return {"ok": True, "file_id": data.get("id")}
        except Exception as exc:
            self._set_setting("backup.gdrive.last_error", str(exc))
            return {"ok": False, "error": str(exc)}

    def _build_payload(self, backup_id: str, created: datetime) -> dict:
        system_data = self._export_system_data()
        user_data = self._export_user_data()
        files = self._collect_files()
        manifest = {
            "backup_version": BACKUP_VERSION,
            "backup_id": backup_id,
            "created_at": created.isoformat(),
            "db_type": self._settings.storage.db_type,
            "app": "unified-platform",
            "sections": ["system-data", "user-data"],
            "file_count": len(files),
            "checksums": {},
        }
        return {"manifest": manifest, "system": system_data, "user": user_data, "files": files}

    def _zip_payload(self, payload: dict) -> bytes:
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            entries = {
                "system-data.json": _json_bytes(payload["system"]),
                "user-data.json": _json_bytes(payload["user"]),
            }
            for arcname, data in entries.items():
                payload["manifest"]["checksums"][arcname] = _sha256(data)
            for rel, abs_path in payload["files"].items():
                data = abs_path.read_bytes()
                arcname = f"files/{rel}"
                entries[arcname] = data
                payload["manifest"]["checksums"][arcname] = _sha256(data)
            manifest_bytes = _json_bytes(payload["manifest"])
            zf.writestr("manifest.json", manifest_bytes)
            for arcname, data in entries.items():
                zf.writestr(arcname, data)
        return buf.getvalue()

    def _export_system_data(self) -> dict:
        from app.core.database import Database

        db = Database(self._settings)
        db.init()
        return db.export_master_setup()

    def _export_user_data(self) -> dict:
        data: dict[str, list[dict]] = {}
        engine = get_engine()
        with engine.connect() as conn:
            for table in Base.metadata.sorted_tables:
                if table.name in USER_TABLES:
                    rows = conn.execute(select(table)).mappings().all()
                    data[table.name] = [dict(row) for row in rows]
        if self._settings.storage.db_type == "sqlite" and self._db_path.exists():
            data["sqlite_snapshot_sha256"] = self._sqlite_snapshot_hash()
        return data

    def _restore_user_data(self, data: dict) -> None:
        session = get_session()
        try:
            tables = [t for t in reversed(Base.metadata.sorted_tables) if t.name in USER_TABLES]
            for table in tables:
                session.execute(delete(table))
            for table in [t for t in Base.metadata.sorted_tables if t.name in USER_TABLES]:
                rows = data.get(table.name) or []
                if rows:
                    session.execute(insert(table), rows)
            session.commit()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    def _restore_system_data(self, data: dict) -> None:
        from app.core.database import Database

        db = Database(self._settings)
        db.init()
        db.import_master_setup(data)

    def _collect_files(self) -> dict[str, Path]:
        files: dict[str, Path] = {}
        for rel_root in SYSTEM_FILE_ROOTS:
            root = (self._root / rel_root).resolve()
            if not root.exists():
                continue
            for item in root.rglob("*"):
                if item.is_file():
                    files[str(item.relative_to(self._root)).replace("\\", "/")] = item
        return files

    def _restore_files(self, zf: zipfile.ZipFile) -> None:
        for name in zf.namelist():
            if not name.startswith("files/") or name.endswith("/"):
                continue
            rel = name.removeprefix("files/")
            target = (self._root / rel).resolve()
            if self._root.resolve() not in target.parents:
                raise ValueError(f"unsafe backup path: {rel}")
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(zf.read(name))

    def _read_package_bytes(self, package: Path) -> bytes:
        data = package.read_bytes()
        return _xor_stream(data, self._backup_encryption_key()) if package.suffix == ".upbak" else data

    def _sqlite_snapshot_hash(self) -> str:
        tmp = self._backup_dir / ".sqlite_snapshot.tmp"
        if tmp.exists():
            tmp.unlink()
        src = sqlite3.connect(str(self._db_path))
        dst = sqlite3.connect(str(tmp))
        src.backup(dst)
        dst.close()
        src.close()
        digest = _sha256(tmp.read_bytes())
        tmp.unlink(missing_ok=True)
        return digest

    def _cleanup_old_backups(self, keep: int) -> None:
        backups = sorted(self._backup_dir.glob("backup_*.*"), key=lambda p: p.stat().st_mtime, reverse=True)
        for old in backups[keep:]:
            old.unlink(missing_ok=True)

    def _log_backup_run(self, result: dict) -> None:
        try:
            from app.core.models import BackupRun

            session = get_session()
            run = BackupRun(
                backup_type=result["type"],
                status=result["status"],
                storage_target=str(self._backup_dir),
                started_at=datetime.fromisoformat(result["started_at"]),
                finished_at=datetime.fromisoformat(result.get("finished_at", result["started_at"])),
                file_path_or_uri=result.get("file_path_or_uri") or result.get("backup_id", ""),
                checksum=result.get("checksum"),
                error_message=result.get("error", ""),
            )
            session.add(run)
            session.commit()
            session.close()
        except Exception as exc:
            logger.warning("backup_log_failed", extra={"context": {"error": str(exc)}})

    def _setting(self, key: str, default: str = "") -> str:
        try:
            from app.core.database import Database

            db = Database(self._settings)
            db.init()
            return db.get_setting(key, default) or default
        except Exception:
            return os.getenv(key.upper().replace(".", "_"), default)

    def _set_setting(self, key: str, value: str) -> None:
        try:
            from app.core.database import Database

            db = Database(self._settings)
            db.init()
            db.set_setting(key, value)
        except Exception:
            logger.warning("backup_setting_write_failed", extra={"context": {"key": key}})

    def _truthy_setting(self, key: str) -> bool:
        return self._setting(key).strip().lower() in {"1", "true", "yes", "on"}

    def _retention_count(self) -> int:
        try:
            return max(1, int(self._setting("backup.retention_count", "7")))
        except ValueError:
            return 7

    def _backup_encryption_key(self) -> str:
        return self._setting("backup.encryption_key") or os.getenv("BACKUP_ENCRYPTION_KEY", "")

    def _package_checksum(self, package: Path) -> str:
        try:
            return _sha256(package.read_bytes()) if package.exists() else ""
        except Exception:
            return ""

    def _telegram_token(self) -> str:
        return os.getenv("TELEGRAM_BOT_TOKEN", "") or self._settings.telegram.bot_token or self._setting("telegram.bot_token")

    def _telegram_error_hint(self, error: str) -> str:
        lowered = error.lower()
        if "unauthorized" in lowered or "not found" in lowered and "bot" in lowered:
            return "Check the Telegram bot token."
        if "chat not found" in lowered:
            return "Check the channel/group ID and add the bot to that chat."
        if "forbidden" in lowered or "not a member" in lowered or "kicked" in lowered:
            return "Add the bot to the channel/group and give it permission to post messages."
        return "Check bot token, chat ID, and bot membership/permissions."

    def _send_telegram_package(self, token: str, channel_id: str, package: Path, result: dict) -> None:
        size = package.stat().st_size
        checksum = result.get("checksum", "n/a")
        if self._telegram_uses_local_api() or size <= TELEGRAM_UPLOAD_LIMIT_BYTES:
            with package.open("rb") as fh:
                self._telegram_post(
                    token,
                    "sendDocument",
                    data={
                        "chat_id": channel_id,
                        "caption": f"SA Helper backup: {package.name}\nChecksum: {checksum}",
                    },
                    files={"document": (package.name, fh, "application/octet-stream")},
                    timeout=180,
                )
            return

        total_parts = (size + TELEGRAM_UPLOAD_LIMIT_BYTES - 1) // TELEGRAM_UPLOAD_LIMIT_BYTES
        with package.open("rb") as fh:
            for part_index in range(1, total_parts + 1):
                chunk = fh.read(TELEGRAM_UPLOAD_LIMIT_BYTES)
                part_name = f"{package.name}.part{part_index:03d}-of-{total_parts:03d}"
                caption = (
                    f"SA Helper backup part {part_index}/{total_parts}: {package.name}\n"
                    f"Checksum: {checksum}\n"
                    "Rejoin parts in order before restore."
                )
                self._telegram_post(
                    token,
                    "sendDocument",
                    data={"chat_id": channel_id, "caption": caption},
                    files={"document": (part_name, io.BytesIO(chunk), "application/octet-stream")},
                    timeout=180,
                )

    def _gdrive_client_id(self) -> str:
        return os.getenv("GOOGLE_DRIVE_CLIENT_ID", "").strip() or self._setting("backup.gdrive.client_id").strip()

    def _gdrive_client_secret(self) -> str:
        return os.getenv("GOOGLE_DRIVE_CLIENT_SECRET", "").strip() or self._setting("backup.gdrive.client_secret").strip()

    def _telegram_post(
        self,
        token: str,
        method: str,
        *,
        data: dict[str, Any],
        files: dict[str, Any] | None = None,
        timeout: int = 60,
    ) -> dict:
        resp = httpx.post(f"{self._telegram_api_base_url()}/bot{token}/{method}", data=data, files=files, timeout=timeout)
        if resp.status_code >= 400:
            raise RuntimeError(resp.text)
        payload = resp.json()
        if not payload.get("ok"):
            raise RuntimeError(payload.get("description") or resp.text)
        return payload

    def _telegram_api_base_url(self) -> str:
        return (
            os.getenv("TELEGRAM_API_BASE_URL", "").strip()
            or (getattr(self._settings.telegram, "api_base_url", "") or "").strip()
            or self._setting("telegram.api_base_url", TELEGRAM_HOSTED_API_BASE_URL)
            or TELEGRAM_HOSTED_API_BASE_URL
        ).rstrip("/")

    def _telegram_uses_local_api(self) -> bool:
        return self._telegram_api_base_url() != TELEGRAM_HOSTED_API_BASE_URL

    def _gdrive_token_data(self) -> dict:
        raw = self._setting("backup.gdrive.token_json")
        if not raw:
            return {}
        try:
            data = json.loads(raw)
            return data if isinstance(data, dict) else {}
        except Exception:
            return {}

    def _save_gdrive_token_data(self, data: dict) -> None:
        self._set_setting("backup.gdrive.token_json", json.dumps(data))

    def _gdrive_access_token(self) -> str:
        data = self._gdrive_token_data()
        if not data:
            return ""
        expires_at = int(data.get("expires_at") or 0)
        if data.get("access_token") and (not expires_at or expires_at > int(time.time()) + 60):
            return data.get("access_token", "")
        refreshed = self._refresh_gdrive_token(data)
        return refreshed.get("access_token", "")

    def _refresh_gdrive_token(self, token_data: dict) -> dict:
        refresh_token = token_data.get("refresh_token")
        client_id = self._gdrive_client_id()
        client_secret = self._gdrive_client_secret()
        if not refresh_token or not client_id or not client_secret:
            return token_data
        try:
            resp = httpx.post(
                "https://oauth2.googleapis.com/token",
                data={
                    "client_id": client_id,
                    "client_secret": client_secret,
                    "refresh_token": refresh_token,
                    "grant_type": "refresh_token",
                },
                timeout=30,
            )
            if resp.status_code >= 400:
                self._set_setting("backup.gdrive.last_error", resp.text)
                return token_data
            updated = token_data | resp.json()
            updated["refresh_token"] = refresh_token
            if updated.get("expires_in"):
                updated["expires_at"] = int(time.time()) + int(updated["expires_in"])
            self._save_gdrive_token_data(updated)
            self._set_setting("backup.gdrive.last_error", "")
            return updated
        except Exception as exc:
            self._set_setting("backup.gdrive.last_error", str(exc))
            return token_data
