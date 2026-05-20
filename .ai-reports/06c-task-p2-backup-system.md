# Task P2 — Backup & Restore System

> **Tasks**: T7, T8, T9, T10  
> **Priority**: P2 (after P0 and P1)  
> **Depends on**: None (independent of P0/P1)  
> **Estimated changes**: ~250 lines modified in backup_service.py, ~40 lines in other files

---

## Files to Read First

1. `backend/app/services/backup_service.py` — entire file (209 lines)
2. `backend/app/api/admin_routes/backups.py` — entire file
3. `backend/app/main.py` — lines 1-50 (lifespan function pattern)
4. `backend/app/core/container.py` — understand how services are wired

---

## T7: Expand BackupService with System/User Split

### Goal

Add `create_system_backup()` and `create_user_backup()` methods that create separate, categorized backups.

**File**: `backend/app/services/backup_service.py`

**Read the existing file first.** Then add these methods to the `BackupService` class:

### Step 7.1: Add imports at the top of the file

Add any missing imports from this list (check what already exists):
```python
import gzip
import os
import subprocess
import tarfile
from io import BytesIO
```

### Step 7.2: Add class constants

Add these constants inside the `BackupService` class, near the top:

```python
    # System backup: platform configuration and data files
    SYSTEM_FILE_PATHS = [
        "data/models/",
        "data/questions/questions.json",
        "data/questions/questions_learned.json",
        "data/hashes/sign_hashes.json",
        "data/hashes/sign_label.json",
        "data/hashes/sign_hashes_perceptual.json",
        "data/userscripts/",
        "data/mappings/",
        "backend/config/config.yaml",
    ]

    SYSTEM_DB_TABLES = [
        "model_routes",
        "domain_model_mappings",
        "platform_settings",
        "autofill_rules",
        "locator_rules",
        "automation_methods",
        "exam_learned",
    ]

    USER_DB_TABLES = [
        "api_keys",
        "api_key_entitlements",
        "usage_events",
        "audit_log",
    ]
```

### Step 7.3: Add system backup method

```python
    def create_system_backup(self) -> dict:
        """
        Create a compressed tarball of system files + DB table exports.
        
        Saves to: {backup_dir}/system/system_{timestamp}.tar.gz
        Returns: {"path": str, "size": int, "tables": list, "files": list}
        """
        from app.core.paths import get_project_root
        project_root = get_project_root()
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        sys_dir = self._backup_dir / "system"
        sys_dir.mkdir(parents=True, exist_ok=True)
        
        tarball_path = sys_dir / f"system_{timestamp}.tar.gz"
        included_files = []
        included_tables = []
        
        with tarfile.open(str(tarball_path), "w:gz") as tar:
            # Add file-based assets
            for rel_path in self.SYSTEM_FILE_PATHS:
                full_path = (project_root / rel_path).resolve()
                if full_path.is_file():
                    tar.add(str(full_path), arcname=rel_path)
                    included_files.append(rel_path)
                elif full_path.is_dir():
                    for child in full_path.rglob("*"):
                        if child.is_file():
                            arc = str(child.relative_to(project_root))
                            tar.add(str(child), arcname=arc)
                            included_files.append(arc)
            
            # Add DB table exports as JSON
            for table_name in self.SYSTEM_DB_TABLES:
                try:
                    rows = self._db.export_table(table_name)
                    data = json.dumps(rows, indent=2, default=str).encode("utf-8")
                    info = tarfile.TarInfo(name=f"db_tables/{table_name}.json")
                    info.size = len(data)
                    tar.addfile(info, BytesIO(data))
                    included_tables.append(table_name)
                except Exception as e:
                    logger.warning(f"system_backup_table_skip: {table_name}: {e}")
        
        # Update latest symlink (copy)
        latest = sys_dir / "latest_system.tar.gz"
        try:
            if latest.exists():
                latest.unlink()
            import shutil
            shutil.copy2(str(tarball_path), str(latest))
        except Exception:
            pass
        
        # Prune old backups (keep 10)
        self._prune_backups(sys_dir, prefix="system_", keep=10)
        
        logger.info("system_backup_created", extra={"context": {
            "path": str(tarball_path),
            "files": len(included_files),
            "tables": len(included_tables),
        }})
        
        return {
            "path": str(tarball_path),
            "size": tarball_path.stat().st_size,
            "files": included_files,
            "tables": included_tables,
        }
```

### Step 7.4: Add user backup method

```python
    def create_user_backup(self) -> dict:
        """
        Export user-related DB tables to compressed JSON.
        
        Saves to: {backup_dir}/users/users_{timestamp}.json.gz
        Returns: {"path": str, "size": int, "tables": dict}
        """
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        user_dir = self._backup_dir / "users"
        user_dir.mkdir(parents=True, exist_ok=True)
        
        export = {
            "_backup_meta": {
                "type": "user_backup",
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "version": 1,
            }
        }
        
        # Export ORM-managed tables (users, subscriptions, payments, user_api_keys)
        try:
            from app.core.db import get_session
            from app.core.models import User, SubscriptionPlan, UserSubscription, PaymentRecord, UserApiKey, UserApiKeyDevice, UsageCycle
            session = get_session()
            try:
                export["users"] = [u.to_dict() for u in session.query(User).all()]
                export["subscription_plans"] = [p.to_dict() for p in session.query(SubscriptionPlan).all()]
                export["user_subscriptions"] = [s.to_dict() for s in session.query(UserSubscription).all()]
                export["payment_records"] = [p.to_dict() for p in session.query(PaymentRecord).all()]
                export["user_api_keys"] = [k.to_dict() for k in session.query(UserApiKey).all()]
                export["user_api_key_devices"] = [d.to_dict() for d in session.query(UserApiKeyDevice).all()]
                export["usage_cycles"] = [c.to_dict() for c in session.query(UsageCycle).all()]
            finally:
                session.close()
        except Exception as e:
            logger.warning(f"user_backup_orm_failed: {e}")
        
        # Export legacy tables
        for table_name in self.USER_DB_TABLES:
            try:
                export[table_name] = self._db.export_table(table_name)
            except Exception as e:
                logger.warning(f"user_backup_table_skip: {table_name}: {e}")
        
        # Write compressed
        out_path = user_dir / f"users_{timestamp}.json.gz"
        with gzip.open(str(out_path), "wt", encoding="utf-8") as f:
            json.dump(export, f, indent=2, default=str)
        
        # Latest copy
        latest = user_dir / "latest_users.json.gz"
        try:
            if latest.exists():
                latest.unlink()
            import shutil
            shutil.copy2(str(out_path), str(latest))
        except Exception:
            pass
        
        self._prune_backups(user_dir, prefix="users_", keep=20)
        
        table_summary = {k: len(v) for k, v in export.items() if isinstance(v, list)}
        logger.info("user_backup_created", extra={"context": {
            "path": str(out_path),
            "tables": table_summary,
        }})
        
        return {
            "path": str(out_path),
            "size": out_path.stat().st_size,
            "tables": table_summary,
        }
```

### Step 7.5: Add helper methods

```python
    def _prune_backups(self, directory: Path, prefix: str, keep: int) -> None:
        """Delete old backups, keeping only the most recent `keep` files."""
        try:
            files = sorted(
                directory.glob(f"{prefix}*"),
                key=lambda p: p.stat().st_mtime,
                reverse=True,
            )
            for stale in files[keep:]:
                stale.unlink(missing_ok=True)
        except Exception as e:
            logger.warning(f"prune_backups_failed: {e}")

    def list_all_backups(self) -> dict:
        """List all backup files for admin dashboard."""
        result = {"system": [], "users": [], "full": []}
        for category in result:
            cat_dir = self._backup_dir / category
            if not cat_dir.exists():
                continue
            for f in sorted(cat_dir.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True):
                if f.is_file() and not f.name.startswith("latest"):
                    result[category].append({
                        "name": f.name,
                        "size": f.stat().st_size,
                        "created": datetime.fromtimestamp(
                            f.stat().st_mtime, tz=timezone.utc
                        ).isoformat(),
                    })
        return result
```

> **Note**: Check if `_backup_dir` is already set in `__init__`. If not, add it using the pattern: `self._backup_dir = Path(settings.storage.sqlite_path).parent / "backups"`. Also check if `export_table()` method exists on `Database` class — if not, use the existing `_export_json_backup()` method pattern.

---

## T8: rclone Integration

### Goal

Add `rclone_sync()` method that uploads backup files to a configured remote.

**File**: `backend/app/services/backup_service.py`  
**Add this method** to the `BackupService` class:

```python
    def rclone_sync(self, backup_path: str | Path) -> dict:
        """
        Upload a backup file to configured rclone remote.
        
        Configuration (from platform_settings):
        - backup.rclone_remote: remote name (e.g., "gdrive")
        - backup.rclone_path: remote folder (e.g., "sa-helper-backups")
        
        Returns: {"success": bool, "remote": str, "error": str}
        """
        backup_path = Path(backup_path)
        remote = self._db.get_setting("backup.rclone_remote", "")
        if not remote:
            return {"success": False, "remote": "", "error": "No rclone remote configured"}
        
        remote_path = self._db.get_setting("backup.rclone_path", "sa-helper-backups")
        
        try:
            cmd = [
                "rclone", "copy",
                str(backup_path),
                f"{remote}:{remote_path}/",
                "--log-level", "ERROR",
            ]
            result = subprocess.run(
                cmd, capture_output=True, text=True, timeout=300,
            )
            if result.returncode != 0:
                error_msg = result.stderr[:500] if result.stderr else "Unknown error"
                logger.error("rclone_failed", extra={"context": {"stderr": error_msg}})
                return {"success": False, "remote": remote, "error": error_msg}
            
            logger.info("rclone_synced", extra={"context": {
                "file": backup_path.name, "remote": remote,
            }})
            return {"success": True, "remote": f"{remote}:{remote_path}", "error": ""}
        except FileNotFoundError:
            msg = "rclone binary not found — install rclone in container"
            logger.error(msg)
            return {"success": False, "remote": remote, "error": msg}
        except subprocess.TimeoutExpired:
            msg = "rclone upload timed out (300s)"
            logger.error(msg)
            return {"success": False, "remote": remote, "error": msg}
        except Exception as e:
            return {"success": False, "remote": remote, "error": str(e)}
```

---

## T9: Telegram Channel Backup

### Goal

Upload backup files to a Telegram channel/group as documents.

**File**: `backend/app/services/backup_service.py`  
**Add this async method** to the `BackupService` class:

```python
    async def telegram_backup(self, backup_path: str | Path) -> dict:
        """
        Upload backup file to Telegram backup channel/group.
        
        Configuration (from platform_settings):
        - backup.telegram_chat_id: chat ID of backup channel (e.g., "-1001234567890")
        
        Telegram bot file size limit: 50 MB.
        
        Returns: {"success": bool, "chat_id": str, "error": str}
        """
        backup_path = Path(backup_path)
        chat_id = self._db.get_setting("backup.telegram_chat_id", "")
        if not chat_id:
            return {"success": False, "chat_id": "", "error": "No backup chat_id configured"}
        
        token = os.getenv("TELEGRAM_BOT_TOKEN", "")
        if not token:
            token = self._db.get_setting("telegram.bot_token", "")
        if not token:
            return {"success": False, "chat_id": chat_id, "error": "No bot token available"}
        
        file_size = backup_path.stat().st_size
        if file_size > 50 * 1024 * 1024:
            return {
                "success": False,
                "chat_id": chat_id,
                "error": f"File too large ({file_size // (1024*1024)}MB > 50MB limit)",
            }
        
        try:
            from telegram import Bot
            bot = Bot(token=token)
            
            caption = (
                f"📦 {backup_path.name}\n"
                f"📅 {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}\n"
                f"📏 {file_size / 1024:.1f} KB"
            )
            
            with open(backup_path, "rb") as f:
                await bot.send_document(
                    chat_id=int(chat_id),
                    document=f,
                    filename=backup_path.name,
                    caption=caption,
                )
            
            logger.info("telegram_backup_uploaded", extra={"context": {
                "file": backup_path.name, "chat_id": chat_id,
            }})
            return {"success": True, "chat_id": chat_id, "error": ""}
        except Exception as e:
            logger.error("telegram_backup_failed", extra={"context": {"error": str(e)}})
            return {"success": False, "chat_id": chat_id, "error": str(e)}
```

---

## T10: Backup Scheduler + Admin API

### Step 10.1: Add backup scheduler to main.py

**File**: `backend/app/main.py`

**Add this function** before the lifespan function:

```python
async def _backup_scheduler(container) -> None:
    """Run automated system + user backups on schedule."""
    # Wait 60 seconds after startup before first check
    await asyncio.sleep(60)
    while True:
        try:
            enabled = container.db.get_setting(
                "backup.enabled", "true"
            ).lower() in ("true", "1", "yes", "on")
            
            if not enabled:
                await asyncio.sleep(3600)
                continue
            
            interval_hours = 6
            try:
                interval_hours = max(1, int(container.db.get_setting("backup.interval_hours", "6")))
            except (ValueError, TypeError):
                pass
            
            await asyncio.sleep(interval_hours * 3600)
            
            # Create backups
            sys_result = container.backup_service.create_system_backup()
            user_result = container.backup_service.create_user_backup()
            
            # rclone sync (non-critical)
            for path in [sys_result["path"], user_result["path"]]:
                try:
                    container.backup_service.rclone_sync(path)
                except Exception as e:
                    logger.warning(f"backup_rclone_skip: {e}")
            
            # Telegram backup (non-critical)
            for path in [sys_result["path"], user_result["path"]]:
                try:
                    await container.backup_service.telegram_backup(path)
                except Exception as e:
                    logger.warning(f"backup_telegram_skip: {e}")
            
            # Alert admin
            try:
                container.alert_service.send(
                    f"✅ Backup: system ({sys_result['size']//1024}KB), "
                    f"users ({user_result['size']//1024}KB)"
                )
            except Exception:
                pass
            
        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.error("backup_scheduler_failed", extra={"context": {"error": str(e)}})
            await asyncio.sleep(3600)
```

**Add to lifespan** (same pattern as merge scheduler):
```python
    backup_task = asyncio.create_task(_backup_scheduler(container))
```
**And in shutdown:**
```python
    backup_task.cancel()
```

### Step 10.2: Add admin backup API endpoints

**File**: `backend/app/api/admin_routes/backups.py`  
**Read existing file first.** Add these endpoints:

```python
@router.post("/api/backups/system")
async def create_system_backup(request: Request) -> Any:
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    try:
        result = container.backup_service.create_system_backup()
        return JSONResponse(result)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@router.post("/api/backups/users")
async def create_user_backup(request: Request) -> Any:
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    try:
        result = container.backup_service.create_user_backup()
        return JSONResponse(result)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@router.get("/api/backups/list")
async def list_backups_all(request: Request) -> Any:
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    try:
        result = container.backup_service.list_all_backups()
        return JSONResponse(result)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@router.post("/api/backups/rclone-sync")
async def rclone_sync_latest(request: Request) -> Any:
    denied = _admin_guard(request)
    if denied:
        return denied
    container = request.app.state.container
    results = []
    for category in ["system", "users"]:
        latest = container.backup_service._backup_dir / category / f"latest_{category}.tar.gz"
        if not latest.exists():
            latest = container.backup_service._backup_dir / category / f"latest_{category}.json.gz"
        if latest.exists():
            r = container.backup_service.rclone_sync(latest)
            results.append({**r, "category": category})
    return JSONResponse({"results": results})
```

---

## Verification

```bash
# 1. Imports
cd backend && python -c "from app.services.backup_service import BackupService; print('OK')"

# 2. Check methods exist
cd backend && python -c "
from app.services.backup_service import BackupService
methods = [m for m in dir(BackupService) if 'backup' in m.lower() or 'rclone' in m.lower() or 'telegram' in m.lower()]
print('Methods:', methods)
"
```

---

## Summary of Changes

| File | Change |
|------|--------|
| `backup_service.py` | +~200 lines — system/user backup, rclone, telegram, list, prune |
| `main.py` | +~40 lines — backup scheduler background task |
| `admin_routes/backups.py` | +~50 lines — 4 new admin endpoints |
