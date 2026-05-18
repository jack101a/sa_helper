"""PostgreSQL backup service with encrypted artifact uploads to Telegram and rclone."""

from __future__ import annotations

import logging
import os
import shutil
import subprocess
import tempfile
import threading
import time
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import httpx
from sqlalchemy import text
from sqlalchemy import desc

from app.core.config import Settings
from app.core.db import get_session
from app.core.models import BackupRun
from app.core.paths import get_project_root

logger = logging.getLogger(__name__)

TELEGRAM_HOSTED_API_BASE_URL = "https://api.telegram.org"


@dataclass
class BackupDestinations:
    telegram: bool
    rclone: bool


class BackupService:
    _ADVISORY_LOCK_KEY = 901245331

    def __init__(self, settings: Settings):
        self._settings = settings
        self._root = get_project_root()
        runtime_override = os.getenv("BACKUP_RUNTIME_ROOT", "").strip()
        if runtime_override:
            self._runtime_root = Path(runtime_override).resolve()
        else:
            self._runtime_root = (self._root / "runtime" / "sa_helper").resolve()
        self._backup_dir = (self._runtime_root / "backups").resolve()
        self._backup_dir.mkdir(parents=True, exist_ok=True)
        self._rclone_dir = (self._runtime_root / "rclone").resolve()
        self._rclone_dir.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._scheduler_thread: threading.Thread | None = None
        self._scheduler_stop = threading.Event()

    # ---------- public lifecycle ----------
    def start_scheduler(self) -> None:
        if self._scheduler_thread and self._scheduler_thread.is_alive():
            return
        self._scheduler_stop.clear()
        self._scheduler_thread = threading.Thread(target=self._scheduler_loop, name="backup-scheduler", daemon=True)
        self._scheduler_thread.start()

    def stop_scheduler(self) -> None:
        self._scheduler_stop.set()
        if self._scheduler_thread and self._scheduler_thread.is_alive():
            self._scheduler_thread.join(timeout=2)

    # ---------- run backup ----------
    def run_backup_now(
        self,
        *,
        telegram: bool | None = None,
        rclone: bool | None = None,
        trigger_type: str = "manual",
        triggered_by: str = "admin",
        schedule_name: str | None = None,
    ) -> dict[str, Any]:
        if not self._lock.acquire(blocking=False):
            return {
                "status": "skipped_due_to_lock",
                "error_summary": "backup already running",
                "trigger_type": trigger_type,
            }

        started = datetime.now(UTC)
        run = BackupRun(
            backup_type="postgres_dump",
            status="running",
            storage_target=str(self._backup_dir),
            started_at=started,
            trigger_type=trigger_type,
            schedule_name=schedule_name,
            triggered_by=triggered_by,
        )
        session = get_session()
        db_lock_acquired = False
        session.add(run)
        session.commit()
        session.refresh(run)

        try:
            db_lock_acquired = self._acquire_db_lock(session)
            if not db_lock_acquired:
                run.status = "skipped_due_to_lock"
                run.finished_at = datetime.now(UTC)
                run.error_summary = "database advisory lock already held"
                session.commit()
                return {
                    "status": "skipped_due_to_lock",
                    "id": run.id,
                    "error_summary": run.error_summary,
                }

            destinations = self._resolve_destinations(telegram=telegram, rclone=rclone)
            artifact = self._create_encrypted_postgres_backup()

            telegram_result = self._upload_to_telegram(artifact, enabled=destinations.telegram)
            rclone_result = self._upload_to_rclone(artifact, enabled=destinations.rclone)

            run.status = "completed"
            run.finished_at = datetime.now(UTC)
            run.file_path_or_uri = str(artifact)
            run.filename = artifact.name
            run.file_size_bytes = artifact.stat().st_size if artifact.exists() else 0
            run.encrypted = self._is_encryption_enabled()
            run.telegram_enabled = destinations.telegram
            run.telegram_status = telegram_result.get("status")
            run.telegram_chat_id = telegram_result.get("chat_id")
            run.telegram_message_id = str(telegram_result.get("message_id") or "") or None
            run.rclone_enabled = destinations.rclone
            run.rclone_status = rclone_result.get("status")
            run.rclone_destination = rclone_result.get("destination")
            run.error_summary = self._merge_errors(telegram_result.get("error"), rclone_result.get("error"))
            session.commit()

            self._cleanup_retention()
            return {
                "status": run.status,
                "id": run.id,
                "filename": run.filename,
                "file_size_bytes": run.file_size_bytes,
                "telegram": telegram_result,
                "rclone": rclone_result,
            }
        except Exception as exc:
            run.status = "failed"
            run.finished_at = datetime.now(UTC)
            run.error_summary = str(exc)
            run.error_message = str(exc)
            session.commit()
            logger.exception("backup_run_failed", extra={"context": {"error": str(exc)}})
            return {"status": "failed", "error": str(exc), "id": run.id}
        finally:
            if db_lock_acquired:
                self._release_db_lock(session)
            session.close()
            self._lock.release()

    # Backward-compatible alias used by older call sites.
    def full_backup(self) -> dict[str, Any]:
        return self.run_backup_now(trigger_type="manual", triggered_by="admin")

    def list_backups(self) -> list[dict[str, Any]]:
        session = get_session()
        try:
            rows = session.query(BackupRun).order_by(desc(BackupRun.id)).limit(100).all()
            out = []
            for r in rows:
                out.append({
                    "id": r.id,
                    "status": r.status,
                    "filename": r.filename,
                    "file_size_bytes": r.file_size_bytes,
                    "encrypted": bool(r.encrypted),
                    "created": r.started_at.isoformat() if r.started_at else None,
                    "finished_at": r.finished_at.isoformat() if r.finished_at else None,
                    "telegram_status": r.telegram_status,
                    "rclone_status": r.rclone_status,
                    "error_summary": r.error_summary,
                    "trigger_type": r.trigger_type,
                    "schedule_name": r.schedule_name,
                    "path": r.file_path_or_uri,
                })
            return out
        finally:
            session.close()

    def get_backup_config_status(self) -> dict[str, Any]:
        return {
            "backup_dir": str(self._backup_dir),
            "encryption_enabled": self._is_encryption_enabled(),
            "encryption_method": self._setting("backup.encryption.method", os.getenv("BACKUP_ENCRYPTION_METHOD", "none")),
            "telegram_enabled": self._truthy_setting("backup.telegram.enabled", env="BACKUP_TELEGRAM_ENABLED"),
            "telegram_chat_id": self._setting("backup.telegram.chat_id", os.getenv("BACKUP_TELEGRAM_CHAT_ID", "")),
            "telegram_send_file": self._truthy_setting("backup.telegram.send_file", env="BACKUP_TELEGRAM_SEND_FILE"),
            "telegram_max_file_mb": self._int_setting("backup.telegram.max_file_mb", os.getenv("BACKUP_TELEGRAM_MAX_FILE_MB", "45"), min_value=1),
            "rclone_enabled": self._truthy_setting("backup.rclone.enabled", env="BACKUP_RCLONE_ENABLED"),
            "rclone_destination": self._setting("backup.rclone.destination", os.getenv("BACKUP_RCLONE_DESTINATION", "")),
            "rclone_config_path": self.rclone_config_path(),
            "rclone_config_present": Path(self.rclone_config_path()).exists(),
            "auto_enabled": self._truthy_setting("backup.auto.enabled", env="BACKUP_AUTO_ENABLED"),
            "schedule_type": self._setting("backup.auto.schedule_type", os.getenv("BACKUP_SCHEDULE_TYPE", "cron")),
            "cron": self._setting("backup.auto.cron", os.getenv("BACKUP_CRON", "0 3 * * *")),
            "interval_hours": self._int_setting("backup.auto.interval_hours", os.getenv("BACKUP_INTERVAL_HOURS", "24"), min_value=1),
            "timezone": self._setting("backup.auto.timezone", os.getenv("BACKUP_TIMEZONE", "Asia/Kolkata")),
            "retention_days": self._int_setting("backup.retention_days", os.getenv("BACKUP_RETENTION_DAYS", "14"), min_value=1),
            "local_retention_count": self._int_setting("backup.local_retention_count", os.getenv("BACKUP_LOCAL_RETENTION_COUNT", "10"), min_value=1),
            "next_run_at": self._next_run_at().isoformat() if self._next_run_at() else None,
            "running": self._lock.locked(),
            "telegram_note": "Hosted Telegram Bot API upload size is limited; large backups may need rclone-only or optional self-hosted Bot API.",
        }

    def get_backup_health(self) -> dict[str, Any]:
        runs = self.list_backups()
        cfg = self.get_backup_config_status()
        return {
            "total_backups": len(runs),
            "last_backup": runs[0] if runs else None,
            "backup_dir": cfg["backup_dir"],
            "db_type": self._settings.storage.db_type,
            "telegram_channel_set": bool(cfg.get("telegram_chat_id")),
            "telegram_token_set": bool(self._telegram_token()),
            "telegram_api_base_url": self._telegram_api_base_url(),
            "telegram_local_api": self._telegram_api_base_url().rstrip("/") != TELEGRAM_HOSTED_API_BASE_URL,
            "rclone_enabled": bool(cfg.get("rclone_enabled")),
            "rclone_destination": cfg.get("rclone_destination"),
            "rclone_config_present": cfg.get("rclone_config_present"),
            "auto_enabled": cfg.get("auto_enabled"),
            "next_run_at": cfg.get("next_run_at"),
            "running": cfg.get("running"),
        }

    def set_backup_settings(self, updates: dict[str, Any]) -> dict[str, Any]:
        allowed = {
            "backup.encryption.enabled",
            "backup.encryption.method",
            "backup.age.recipient",
            "backup.gpg.recipient",
            "backup.telegram.enabled",
            "backup.telegram.chat_id",
            "backup.telegram.send_file",
            "backup.telegram.max_file_mb",
            "backup.rclone.enabled",
            "backup.rclone.destination",
            "backup.auto.enabled",
            "backup.auto.schedule_type",
            "backup.auto.cron",
            "backup.auto.interval_hours",
            "backup.auto.timezone",
            "backup.retention_days",
            "backup.local_retention_count",
        }
        for key, value in updates.items():
            if key not in allowed:
                continue
            self._validate_setting(key, value)
            self._set_setting(key, str(value))
        return self.get_backup_config_status()

    def test_telegram_chat(self, chat_id: str | None = None) -> dict[str, Any]:
        token = self._telegram_token()
        target = (chat_id or self._setting("backup.telegram.chat_id", "")).strip()
        if not token:
            return {"ok": False, "error": "TELEGRAM_BOT_TOKEN missing"}
        if not target:
            return {"ok": False, "error": "backup telegram chat_id missing"}
        payload = self._telegram_post(
            token,
            "sendMessage",
            data={"chat_id": target, "text": f"Backup destination test ({datetime.now(UTC).isoformat()})"},
        )
        return {"ok": True, "chat_id": target, "message_id": payload.get("result", {}).get("message_id")}

    def send_telegram_test_file(self, chat_id: str | None = None) -> dict[str, Any]:
        token = self._telegram_token()
        target = (chat_id or self._setting("backup.telegram.chat_id", "")).strip()
        if not token:
            return {"ok": False, "error": "TELEGRAM_BOT_TOKEN missing"}
        if not target:
            return {"ok": False, "error": "backup telegram chat_id missing"}

        tmp = self._backup_dir / f"telegram_test_{datetime.now(UTC).strftime('%Y%m%dT%H%M%SZ')}.txt"
        tmp.write_text("SA Helper backup test file", encoding="utf-8")
        try:
            with tmp.open("rb") as fh:
                payload = self._telegram_post(
                    token,
                    "sendDocument",
                    data={"chat_id": target, "caption": "Backup test file"},
                    files={"document": (tmp.name, fh, "text/plain")},
                )
            return {"ok": True, "chat_id": target, "message_id": payload.get("result", {}).get("message_id")}
        finally:
            tmp.unlink(missing_ok=True)

    def upload_rclone_conf(self, raw: bytes) -> dict[str, Any]:
        max_bytes = 2 * 1024 * 1024
        if len(raw) > max_bytes:
            return {"ok": False, "error": "rclone.conf exceeds 2MB limit"}
        conf_path = Path(self.rclone_config_path())
        conf_path.parent.mkdir(parents=True, exist_ok=True)
        conf_path.write_bytes(raw)
        try:
            os.chmod(conf_path, 0o600)
        except Exception:
            pass
        return {"ok": True, "path": str(conf_path), "size": conf_path.stat().st_size}

    def rclone_config_path(self) -> str:
        return self._setting("backup.rclone.config", os.getenv("RCLONE_CONFIG", str((self._rclone_dir / "rclone.conf").resolve())))

    def test_rclone(self) -> dict[str, Any]:
        return self._run_rclone(["--version"])

    def list_rclone_remotes(self) -> dict[str, Any]:
        return self._run_rclone(["listremotes"])

    def test_rclone_destination(self, destination: str | None = None) -> dict[str, Any]:
        dest = (destination or self._setting("backup.rclone.destination", os.getenv("BACKUP_RCLONE_DESTINATION", ""))).strip()
        if not dest:
            return {"ok": False, "error": "destination missing"}
        return self._run_rclone(["lsf", dest])

    def upload_rclone_test_file(self, destination: str | None = None) -> dict[str, Any]:
        dest = (destination or self._setting("backup.rclone.destination", os.getenv("BACKUP_RCLONE_DESTINATION", ""))).strip()
        if not dest:
            return {"ok": False, "error": "destination missing"}
        tmp = self._backup_dir / f"rclone_test_{datetime.now(UTC).strftime('%Y%m%dT%H%M%SZ')}.txt"
        tmp.write_text("rclone backup test", encoding="utf-8")
        try:
            return self._run_rclone(["copy", str(tmp), dest])
        finally:
            tmp.unlink(missing_ok=True)

    # ---------- internals ----------
    def _create_encrypted_postgres_backup(self) -> Path:
        ts = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
        dump_path = self._backup_dir / f"sa_helper_{ts}.dump"
        globals_path = self._backup_dir / f"sa_helper_globals_{ts}.sql"

        pg_env = os.environ.copy()
        pg_env["PGPASSWORD"] = self._settings.storage.postgres_password

        self._run_subprocess([
            "pg_dump",
            "-h", self._settings.storage.postgres_host,
            "-p", str(self._settings.storage.postgres_port),
            "-U", self._settings.storage.postgres_user,
            "-d", self._settings.storage.postgres_db,
            "-Fc",
            "-f", str(dump_path),
        ], env=pg_env, timeout=300)

        include_globals = self._truthy_setting("backup.postgres.include_globals")
        if include_globals:
            self._run_subprocess([
                "pg_dumpall",
                "-h", self._settings.storage.postgres_host,
                "-p", str(self._settings.storage.postgres_port),
                "-U", self._settings.storage.postgres_user,
                "--globals-only",
            ], env=pg_env, timeout=180, stdout_path=globals_path)

        archive_path = self._backup_dir / f"sa_helper_{ts}.tar.gz"
        with tempfile.TemporaryDirectory() as td:
            staged = Path(td)
            shutil.copy2(dump_path, staged / dump_path.name)
            if include_globals and globals_path.exists():
                shutil.copy2(globals_path, staged / globals_path.name)
            self._create_tar_gz(staged, archive_path)

        dump_path.unlink(missing_ok=True)
        globals_path.unlink(missing_ok=True)

        encrypted = self._encrypt_archive(archive_path)
        if encrypted != archive_path:
            archive_path.unlink(missing_ok=True)
        return encrypted

    def _encrypt_archive(self, archive_path: Path) -> Path:
        if not self._is_encryption_enabled():
            return archive_path

        method = self._setting("backup.encryption.method", os.getenv("BACKUP_ENCRYPTION_METHOD", "age")).strip().lower()
        if method == "age":
            recipient = self._setting("backup.age.recipient", os.getenv("BACKUP_AGE_RECIPIENT", "")).strip()
            if not recipient:
                raise RuntimeError("backup encryption enabled but BACKUP_AGE_RECIPIENT missing")
            out_path = archive_path.with_suffix(archive_path.suffix + ".age")
            self._run_subprocess(["age", "-r", recipient, "-o", str(out_path), str(archive_path)], timeout=120)
            return out_path

        if method == "gpg":
            recipient = self._setting("backup.gpg.recipient", os.getenv("BACKUP_GPG_RECIPIENT", "")).strip()
            if not recipient:
                raise RuntimeError("backup encryption enabled but BACKUP_GPG_RECIPIENT missing")
            out_path = archive_path.with_suffix(archive_path.suffix + ".gpg")
            self._run_subprocess([
                "gpg", "--batch", "--yes", "--trust-model", "always", "--encrypt", "--recipient", recipient,
                "--output", str(out_path), str(archive_path)
            ], timeout=120)
            return out_path

        if method == "none":
            return archive_path

        raise RuntimeError(f"unsupported backup encryption method: {method}")

    def _upload_to_telegram(self, artifact: Path, *, enabled: bool) -> dict[str, Any]:
        if not enabled:
            return {"status": "disabled"}

        token = self._telegram_token()
        chat_id = self._setting("backup.telegram.chat_id", os.getenv("BACKUP_TELEGRAM_CHAT_ID", "")).strip()
        send_file = self._truthy_setting("backup.telegram.send_file", env="BACKUP_TELEGRAM_SEND_FILE")
        max_mb = self._int_setting("backup.telegram.max_file_mb", os.getenv("BACKUP_TELEGRAM_MAX_FILE_MB", "45"), min_value=1)
        max_bytes = max_mb * 1024 * 1024

        if not token:
            return {"status": "failed", "error": "telegram token missing"}
        if not chat_id:
            return {"status": "failed", "error": "telegram chat_id missing"}
        if not send_file:
            return {"status": "skipped", "error": "telegram send_file disabled", "chat_id": chat_id}
        if artifact.stat().st_size > max_bytes:
            return {"status": "skipped", "error": f"artifact exceeds BACKUP_TELEGRAM_MAX_FILE_MB ({max_mb}MB)", "chat_id": chat_id}

        with artifact.open("rb") as fh:
            payload = self._telegram_post(
                token,
                "sendDocument",
                data={"chat_id": chat_id, "caption": f"Encrypted backup {artifact.name}"},
                files={"document": (artifact.name, fh, "application/octet-stream")},
                timeout=300,
            )
        return {
            "status": "uploaded",
            "chat_id": chat_id,
            "message_id": payload.get("result", {}).get("message_id"),
        }

    def _upload_to_rclone(self, artifact: Path, *, enabled: bool) -> dict[str, Any]:
        if not enabled:
            return {"status": "disabled"}
        destination = self._setting("backup.rclone.destination", os.getenv("BACKUP_RCLONE_DESTINATION", "")).strip()
        if not destination:
            return {"status": "failed", "error": "rclone destination missing"}

        result = self._run_rclone(["copy", str(artifact), destination])
        if not result.get("ok"):
            return {"status": "failed", "error": result.get("error"), "destination": destination}
        return {"status": "uploaded", "destination": destination}

    def _run_rclone(self, args: list[str]) -> dict[str, Any]:
        conf = self.rclone_config_path()
        if not Path(conf).exists():
            return {"ok": False, "error": "rclone.conf missing"}
        env = os.environ.copy()
        env["RCLONE_CONFIG"] = conf
        cmd = ["rclone", *args]
        try:
            proc = subprocess.run(cmd, capture_output=True, text=True, timeout=120, env=env, check=False)
        except FileNotFoundError:
            return {"ok": False, "error": "rclone not installed"}
        except subprocess.TimeoutExpired:
            return {"ok": False, "error": "rclone command timed out"}

        if proc.returncode != 0:
            return {"ok": False, "error": proc.stderr.strip() or proc.stdout.strip() or "rclone failed"}
        return {"ok": True, "output": proc.stdout.strip()}

    def _run_subprocess(
        self,
        cmd: list[str],
        *,
        env: dict[str, str] | None = None,
        timeout: int = 120,
        stdout_path: Path | None = None,
    ) -> None:
        stdout_target = subprocess.PIPE
        if stdout_path is not None:
            stdout_target = open(stdout_path, "wb")
        try:
            proc = subprocess.run(
                cmd,
                env=env,
                stdout=stdout_target,
                stderr=subprocess.PIPE,
                timeout=timeout,
                check=False,
            )
        except FileNotFoundError as exc:
            raise RuntimeError(f"required command not found: {cmd[0]}") from exc
        except subprocess.TimeoutExpired as exc:
            raise RuntimeError(f"command timed out: {cmd[0]}") from exc
        finally:
            if stdout_path is not None and hasattr(stdout_target, "close"):
                stdout_target.close()

        if proc.returncode != 0:
            err = (proc.stderr or b"").decode("utf-8", errors="ignore").strip()
            raise RuntimeError(f"command failed: {cmd[0]} ({err or 'unknown error'})")

    def _acquire_db_lock(self, session) -> bool:
        if self._settings.storage.db_type != "postgresql":
            return True
        row = session.execute(text("SELECT pg_try_advisory_lock(:k)"), {"k": self._ADVISORY_LOCK_KEY}).scalar()
        return bool(row)

    def _release_db_lock(self, session) -> None:
        if self._settings.storage.db_type != "postgresql":
            return
        try:
            session.execute(text("SELECT pg_advisory_unlock(:k)"), {"k": self._ADVISORY_LOCK_KEY})
            session.commit()
        except Exception:
            session.rollback()

    def _create_tar_gz(self, source_dir: Path, out_path: Path) -> None:
        import tarfile

        with tarfile.open(out_path, "w:gz") as tar:
            for item in source_dir.iterdir():
                tar.add(item, arcname=item.name)

    def _resolve_destinations(self, *, telegram: bool | None, rclone: bool | None) -> BackupDestinations:
        tg = self._truthy_setting("backup.telegram.enabled", env="BACKUP_TELEGRAM_ENABLED") if telegram is None else bool(telegram)
        rc = self._truthy_setting("backup.rclone.enabled", env="BACKUP_RCLONE_ENABLED") if rclone is None else bool(rclone)
        return BackupDestinations(telegram=tg, rclone=rc)

    def _is_encryption_enabled(self) -> bool:
        return self._truthy_setting("backup.encryption.enabled", env="BACKUP_ENCRYPTION_ENABLED")

    def _cleanup_retention(self) -> None:
        retention_days = self._int_setting("backup.retention_days", os.getenv("BACKUP_RETENTION_DAYS", "14"), min_value=1)
        retention_count = self._int_setting("backup.local_retention_count", os.getenv("BACKUP_LOCAL_RETENTION_COUNT", "10"), min_value=1)
        now = datetime.now(UTC)
        files = sorted([p for p in self._backup_dir.glob("sa_helper_*") if p.is_file()], key=lambda p: p.stat().st_mtime, reverse=True)
        for i, path in enumerate(files):
            age_days = (now - datetime.fromtimestamp(path.stat().st_mtime, tz=UTC)).days
            if i >= retention_count or age_days > retention_days:
                path.unlink(missing_ok=True)

    def _scheduler_loop(self) -> None:
        while not self._scheduler_stop.is_set():
            try:
                if self._truthy_setting("backup.auto.enabled", env="BACKUP_AUTO_ENABLED"):
                    if self._should_run_now():
                        self.run_backup_now(trigger_type="scheduled", triggered_by="system", schedule_name="auto-backup")
                        self._set_setting("backup.auto.last_run_at", datetime.now(UTC).isoformat())
                time.sleep(30)
            except Exception as exc:
                self._set_setting("backup.auto.last_error", str(exc))
                logger.exception("backup_scheduler_failed", extra={"context": {"error": str(exc)}})
                time.sleep(30)

    def _should_run_now(self) -> bool:
        now = datetime.now(UTC)
        next_run = self._next_run_at()
        if next_run is None:
            return False
        return now >= next_run

    def _next_run_at(self) -> datetime | None:
        tz_name = self._setting("backup.auto.timezone", os.getenv("BACKUP_TIMEZONE", "Asia/Kolkata"))
        try:
            tz = ZoneInfo(tz_name)
        except Exception:
            tz = ZoneInfo("UTC")

        schedule_type = self._setting("backup.auto.schedule_type", os.getenv("BACKUP_SCHEDULE_TYPE", "cron")).strip().lower()
        last_run_raw = self._setting("backup.auto.last_run_at", "")
        last_run = None
        if last_run_raw:
            try:
                last_run = datetime.fromisoformat(last_run_raw)
                if last_run.tzinfo is None:
                    last_run = last_run.replace(tzinfo=UTC)
            except Exception:
                last_run = None

        if schedule_type == "interval":
            hours = self._int_setting("backup.auto.interval_hours", os.getenv("BACKUP_INTERVAL_HOURS", "24"), min_value=1)
            if not last_run:
                return datetime.now(UTC)
            return last_run + timedelta(hours=hours)

        # cron support simplified to "M H * * *"
        cron = self._setting("backup.auto.cron", os.getenv("BACKUP_CRON", "0 3 * * *")).strip()
        parts = cron.split()
        if len(parts) != 5:
            return None
        minute, hour = parts[0], parts[1]
        if minute == "*" or hour == "*":
            return None
        try:
            m = int(minute)
            h = int(hour)
        except ValueError:
            return None

        local_now = datetime.now(tz)
        candidate = local_now.replace(hour=h, minute=m, second=0, microsecond=0)
        if candidate <= local_now:
            candidate = candidate + timedelta(days=1)
        return candidate.astimezone(UTC)

    def _telegram_token(self) -> str:
        return os.getenv("TELEGRAM_BOT_TOKEN", "") or self._settings.telegram.bot_token

    def _telegram_api_base_url(self) -> str:
        return (
            os.getenv("TELEGRAM_API_BASE_URL", "").strip()
            or (getattr(self._settings.telegram, "api_base_url", "") or "").strip()
            or TELEGRAM_HOSTED_API_BASE_URL
        ).rstrip("/")

    def _telegram_post(self, token: str, method: str, *, data: dict[str, Any], files: dict[str, Any] | None = None, timeout: int = 60) -> dict[str, Any]:
        resp = httpx.post(f"{self._telegram_api_base_url()}/bot{token}/{method}", data=data, files=files, timeout=timeout)
        if resp.status_code >= 400:
            raise RuntimeError(resp.text)
        payload = resp.json()
        if not payload.get("ok"):
            raise RuntimeError(payload.get("description") or resp.text)
        return payload

    def _merge_errors(self, *errors: str | None) -> str | None:
        vals = [e for e in errors if e]
        return " | ".join(vals) if vals else None

    def _validate_setting(self, key: str, value: Any) -> None:
        token = str(value).strip()
        if key == "backup.encryption.method" and token.lower() not in {"age", "gpg", "none"}:
            raise ValueError("backup.encryption.method must be age|gpg|none")
        if key == "backup.telegram.max_file_mb":
            iv = int(token)
            if iv < 1 or iv > 2000:
                raise ValueError("backup.telegram.max_file_mb must be between 1 and 2000")
        if key == "backup.rclone.destination" and token and ":" not in token:
            raise ValueError("backup.rclone.destination must look like remote:path/")
        if key == "backup.auto.schedule_type" and token.lower() not in {"cron", "interval"}:
            raise ValueError("backup.auto.schedule_type must be cron or interval")
        if key == "backup.auto.interval_hours" and int(token) < 1:
            raise ValueError("backup.auto.interval_hours must be >= 1")
        if key == "backup.retention_days" and int(token) < 1:
            raise ValueError("backup.retention_days must be >= 1")
        if key == "backup.local_retention_count" and int(token) < 1:
            raise ValueError("backup.local_retention_count must be >= 1")
        if key == "backup.telegram.chat_id" and token:
            if not (token.startswith("@") or token.startswith("-") or token.isdigit()):
                raise ValueError("backup.telegram.chat_id must be @channel, negative chat id, or numeric id")

    def _setting(self, key: str, default: str = "") -> str:
        try:
            from app.core.database import Database

            db = Database(self._settings)
            db.init()
            return db.get_setting(key, default) or default
        except Exception:
            return default

    def _set_setting(self, key: str, value: str) -> None:
        try:
            from app.core.database import Database

            db = Database(self._settings)
            db.init()
            db.set_setting(key, value)
        except Exception:
            logger.warning("backup_setting_write_failed", extra={"context": {"key": key}})

    def _truthy_setting(self, key: str, *, env: str | None = None) -> bool:
        default = os.getenv(env or "", "") if env else ""
        value = self._setting(key, default)
        return str(value).strip().lower() in {"1", "true", "yes", "on"}

    def _int_setting(self, key: str, default: str, *, min_value: int = 0) -> int:
        raw = self._setting(key, default)
        try:
            value = int(str(raw).strip())
        except Exception:
            value = int(default)
        return max(min_value, value)
