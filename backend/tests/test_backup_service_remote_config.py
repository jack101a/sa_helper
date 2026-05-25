from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

from app.services import backup_service
from app.services.backup_service import BackupService


def _service(tmp_path, monkeypatch):
    settings = MagicMock()
    settings.storage.sqlite_path = str(tmp_path / "app.db")
    settings.telegram = SimpleNamespace(bot_token="")
    monkeypatch.setenv("RCLONE_CONFIG", str(tmp_path / "rclone.conf"))
    service = BackupService(settings)
    store = {}
    service._setting = lambda key, default="": store.get(key, default)
    service._set_setting = lambda key, value: store.__setitem__(key, value)
    return service, store, Path(tmp_path / "rclone.conf")


def test_save_remote_backup_config_writes_settings_and_rclone_conf(tmp_path, monkeypatch):
    service, store, config_path = _service(tmp_path, monkeypatch)
    monkeypatch.setattr(backup_service.shutil, "which", lambda _name: None)

    result = service.save_remote_backup_config({
        "telegram_chat_id": " -100123 ",
        "rclone_remote": "gdrive:",
        "rclone_path": "/sa-helper-backups/",
        "rclone_config": "[gdrive]\ntype = drive\n",
    })

    assert store["backup.telegram_chat_id"] == "-100123"
    assert store["backup.rclone_remote"] == "gdrive"
    assert store["backup.rclone_path"] == "sa-helper-backups"
    assert config_path.read_text(encoding="utf-8") == "[gdrive]\ntype = drive\n"
    assert result["rclone_config_exists"] is True
    assert result["rclone_config"] == "[gdrive]\ntype = drive\n"


def test_rclone_remote_test_uses_saved_config_and_remote_root(tmp_path, monkeypatch):
    service, store, config_path = _service(tmp_path, monkeypatch)
    store["backup.rclone_remote"] = "gdrive"
    store["backup.rclone_path"] = "sa-helper-backups"
    config_path.write_text("[gdrive]\ntype = drive\n", encoding="utf-8")
    seen = {}

    class Result:
        returncode = 0
        stdout = "          -1 2026-05-25 backup-folder\n"
        stderr = ""

    def fake_run(cmd, **kwargs):
        seen["cmd"] = cmd
        seen["kwargs"] = kwargs
        return Result()

    monkeypatch.setattr(backup_service.shutil, "which", lambda _name: "/usr/bin/rclone")
    monkeypatch.setattr(backup_service.subprocess, "run", fake_run)

    result = service.test_rclone_remote()

    assert result["ok"] is True
    assert result["remote"] == "gdrive:sa-helper-backups"
    assert seen["cmd"] == ["rclone", "--config", str(config_path), "lsd", "gdrive:"]
    assert seen["kwargs"]["timeout"] == 30
    assert store["backup.rclone_last_error"] == ""
