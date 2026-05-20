# 05d — Backup & Restore System (rclone + Telegram)

> Part of [05-opus-final-architecture-plan.md](./05-opus-final-architecture-plan.md)

---

## Design Principle: Two Backup Categories

| Category | Contents | Frequency | Recovery Priority |
|----------|----------|-----------|-------------------|
| **System Backup** | ONNX models, questions.json, sign hashes, autofill rules, captcha rules, userscripts, config.yaml | Daily + on-change | HIGH — platform won't work without these |
| **User Backup** | users table, subscriptions, payments, API keys, user_api_keys, user_api_key_devices, usage events, audit logs, exam_learned | Every 6 hours | CRITICAL — user data is irreplaceable |

---

## Current State

**Existing** (`backup_service.py`, 209 lines):
- `full_backup()` — SQLite `sqlite3.backup()` → binary `.db` file
- `_export_json_backup()` — exports all tables to JSON
- `_export_master_setup()` — exports admin setup (models, mappings, domains, settings)
- Backup files saved to `backend/logs/backups/`
- Auto-backup on admin config changes (`_write_auto_backup()` in admin utils)
- **No rclone integration**
- **No Telegram channel backup**
- **No scheduled backups**
- **No restore API**

---

## Target Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    BACKUP SCHEDULER                     │
│                                                          │
│  Every 6 hours:                                         │
│  ├─ 1. System backup → /backups/system/                  │
│  ├─ 2. User backup → /backups/users/                    │
│  ├─ 3. rclone sync → Google Drive / S3 / remote         │
│  └─ 4. Upload to Telegram backup channel                │
│                                                          │
│  On-change triggers:                                     │
│  ├─ ONNX model upload → system backup                   │
│  ├─ Admin config change → system backup                 │
│  └─ Exam merge → system backup                          │
└─────────────────────────────────────────────────────────┘

Storage Layout:
/app/backend/logs/backups/
├── system/
│   ├── system_20260519_120000.tar.gz     ← compressed bundle
│   ├── system_20260519_060000.tar.gz
│   └── latest_system.tar.gz              ← symlink
├── users/
│   ├── users_20260519_120000.json.gz     ← compressed JSON
│   ├── users_20260519_060000.json.gz
│   └── latest_users.json.gz             ← symlink
└── full/
    ├── app_20260519_120000.db            ← SQLite binary backup
    └── latest_app.db                     ← symlink
```

---

## Implementation

### 1. System Backup Contents

```python
SYSTEM_BACKUP_PATHS = [
    # ONNX models
    "data/models/",
    # Question banks
    "data/questions/questions.json",
    "data/questions/questions_learned.json",
    # Sign hashes
    "data/hashes/sign_hashes.json",
    "data/hashes/sign_label.json",
    "data/hashes/sign_hashes_perceptual.json",
    # Autofill rules
    "data/userscripts/",
    "data/mappings/",
    # Config
    "backend/config/config.yaml",
    # Captcha rules (model routes, domain mappings from DB)
    # → exported as JSON from database tables
]

SYSTEM_DB_TABLES = [
    "model_routes",
    "domain_model_mappings",
    "platform_settings",
    "autofill_rules",
    "locator_rules",
    "automation_methods",
]
```

### 2. User Backup Contents

```python
USER_DB_TABLES = [
    "users",
    "subscription_plans",
    "user_subscriptions",
    "payment_records",
    "user_api_keys",
    "user_api_key_devices",
    "usage_cycles",
    # Legacy tables
    "api_keys",
    "api_key_entitlements",
    "usage_events",
    "audit_log",
]
```

### 3. Backup Service Expansion

**Modify** `backend/app/services/backup_service.py`:

```python
class BackupService:
    """Unified backup with rclone + Telegram support."""
    
    def __init__(self, settings, db, data_dir):
        self._settings = settings
        self._db = db
        self._data_dir = data_dir
        self._backup_dir = Path(settings.storage.sqlite_path).parent / "backups"
        self._backup_dir.mkdir(parents=True, exist_ok=True)
    
    # ── System Backup ─────────────────────────────────────────
    
    def create_system_backup(self) -> Path:
        """Bundle system files + DB tables into a compressed tarball."""
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        sys_dir = self._backup_dir / "system"
        sys_dir.mkdir(parents=True, exist_ok=True)
        
        tarball = sys_dir / f"system_{timestamp}.tar.gz"
        
        with tarfile.open(tarball, "w:gz") as tar:
            # Add file-based assets
            for rel_path in SYSTEM_BACKUP_PATHS:
                full = self._data_dir.parent / rel_path
                if full.exists():
                    tar.add(full, arcname=rel_path)
            
            # Add DB table exports as JSON
            db_export = self._export_tables(SYSTEM_DB_TABLES)
            json_bytes = json.dumps(db_export, indent=2).encode("utf-8")
            info = tarfile.TarInfo(name="system_tables.json")
            info.size = len(json_bytes)
            tar.addfile(info, BytesIO(json_bytes))
        
        # Update latest symlink
        latest = sys_dir / "latest_system.tar.gz"
        if latest.exists():
            latest.unlink()
        shutil.copy2(tarball, latest)
        
        self._prune_old_backups(sys_dir, prefix="system_", keep=10)
        return tarball
    
    # ── User Backup ───────────────────────────────────────────
    
    def create_user_backup(self) -> Path:
        """Export all user-related tables to compressed JSON."""
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        user_dir = self._backup_dir / "users"
        user_dir.mkdir(parents=True, exist_ok=True)
        
        export = self._export_tables(USER_DB_TABLES)
        export["_backup_meta"] = {
            "type": "user_backup",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "version": 1,
        }
        
        out_path = user_dir / f"users_{timestamp}.json.gz"
        with gzip.open(out_path, "wt", encoding="utf-8") as f:
            json.dump(export, f, indent=2, default=str)
        
        latest = user_dir / "latest_users.json.gz"
        if latest.exists():
            latest.unlink()
        shutil.copy2(out_path, latest)
        
        self._prune_old_backups(user_dir, prefix="users_", keep=20)
        return out_path
    
    # ── Full DB Backup ────────────────────────────────────────
    
    def create_full_backup(self) -> Path:
        """Binary SQLite backup using sqlite3 API."""
        # Already exists — keep as-is
        ...
    
    # ── rclone Sync ───────────────────────────────────────────
    
    def rclone_sync(self, backup_path: Path) -> bool:
        """Sync backup file to configured rclone remote."""
        remote = self._db.get_setting("backup.rclone_remote", "")
        if not remote:
            logger.info("rclone_skip: no remote configured")
            return False
        
        remote_path = self._db.get_setting(
            "backup.rclone_path", 
            "sa-helper-backups"
        )
        
        try:
            cmd = [
                "rclone", "copy",
                str(backup_path),
                f"{remote}:{remote_path}/",
                "--progress",
                "--log-level", "ERROR",
            ]
            result = subprocess.run(
                cmd, capture_output=True, text=True, timeout=300,
            )
            if result.returncode != 0:
                logger.error("rclone_failed", extra={
                    "context": {"stderr": result.stderr[:500]}
                })
                return False
            logger.info("rclone_synced", extra={
                "context": {"file": backup_path.name, "remote": remote}
            })
            return True
        except FileNotFoundError:
            logger.error("rclone binary not found — install rclone")
            return False
        except subprocess.TimeoutExpired:
            logger.error("rclone_timeout")
            return False
    
    # ── Telegram Channel Backup ───────────────────────────────
    
    async def telegram_backup(self, backup_path: Path) -> bool:
        """Upload backup file to Telegram backup channel/group."""
        chat_id = self._db.get_setting("backup.telegram_chat_id", "")
        if not chat_id:
            return False
        
        token = os.getenv("TELEGRAM_BOT_TOKEN", "")
        if not token:
            token = self._db.get_setting("telegram.bot_token", "")
        if not token:
            return False
        
        try:
            from telegram import Bot
            bot = Bot(token=token)
            
            file_size = backup_path.stat().st_size
            
            # Telegram file size limit: 50 MB for bots
            if file_size > 50 * 1024 * 1024:
                logger.warning("backup_too_large_for_telegram", extra={
                    "context": {"size_mb": file_size / (1024*1024)}
                })
                return False
            
            caption = (
                f"📦 Backup: {backup_path.name}\n"
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
            
            logger.info("telegram_backup_uploaded", extra={
                "context": {"file": backup_path.name, "chat_id": chat_id}
            })
            return True
        except Exception as e:
            logger.error("telegram_backup_failed", extra={
                "context": {"error": str(e)}
            })
            return False
```

### 4. Backup Scheduler

**Add to `main.py` lifespan**:

```python
async def _backup_scheduler(container):
    """Run automated backups on schedule."""
    while True:
        try:
            interval = int(container.db.get_setting("backup.interval_hours", "6"))
            await asyncio.sleep(interval * 3600)
            
            # System backup
            sys_path = container.backup_service.create_system_backup()
            logger.info(f"System backup: {sys_path.name}")
            
            # User backup
            user_path = container.backup_service.create_user_backup()
            logger.info(f"User backup: {user_path.name}")
            
            # Full DB backup
            db_path = container.backup_service.create_full_backup()
            
            # Sync via rclone (all backups)
            for path in [sys_path, user_path, db_path]:
                container.backup_service.rclone_sync(path)
            
            # Secondary: Telegram channel
            for path in [sys_path, user_path]:
                await container.backup_service.telegram_backup(path)
            
            # Notify admin
            container.alert_service.send(
                f"✅ Backup complete: system ({sys_path.stat().st_size//1024}KB), "
                f"users ({user_path.stat().st_size//1024}KB)"
            )
        except Exception as e:
            logger.error("backup_scheduler_failed", extra={"context": {"error": str(e)}})
            await asyncio.sleep(3600)  # Retry in 1 hour on failure
```

### 5. Restore Procedures

#### System Restore

```python
def restore_system_backup(self, backup_path: Path) -> dict:
    """Restore system backup from tarball."""
    if not backup_path.exists():
        raise FileNotFoundError(f"Backup not found: {backup_path}")
    
    restored = {"files": [], "tables": []}
    
    with tarfile.open(backup_path, "r:gz") as tar:
        # Extract file-based assets
        for member in tar.getmembers():
            if member.name == "system_tables.json":
                continue
            dest = self._data_dir.parent / member.name
            dest.parent.mkdir(parents=True, exist_ok=True)
            tar.extract(member, path=self._data_dir.parent)
            restored["files"].append(member.name)
        
        # Restore DB tables
        json_member = tar.getmember("system_tables.json")
        f = tar.extractfile(json_member)
        if f:
            tables = json.loads(f.read())
            for table_name, rows in tables.items():
                if table_name.startswith("_"):
                    continue
                self._restore_table(table_name, rows)
                restored["tables"].append(table_name)
    
    return restored
```

#### User Restore

```python
def restore_user_backup(self, backup_path: Path) -> dict:
    """Restore user data from JSON backup."""
    with gzip.open(backup_path, "rt", encoding="utf-8") as f:
        data = json.load(f)
    
    restored = {"tables": []}
    for table_name, rows in data.items():
        if table_name.startswith("_"):
            continue
        if table_name in USER_DB_TABLES:
            self._restore_table(table_name, rows)
            restored["tables"].append(f"{table_name} ({len(rows)} rows)")
    
    return restored
```

### 6. Admin Dashboard — Backup Panel

**Add to Settings panel or new Backup panel**:

```
┌─────────────────────────────────────────────────┐
│  💾 Backup & Restore                            │
├─────────────────────────────────────────────────┤
│                                                  │
│  Automated Backups: ✅ Enabled (every 6 hours)  │
│  Last Backup: 2 hours ago                       │
│  rclone Remote: gdrive:sa-helper-backups ✅     │
│  Telegram Channel: -1001234567890 ✅            │
│                                                  │
│  Recent Backups:                                │
│  ┌──────────────────────────────────────────┐   │
│  │ system_20260519_120000.tar.gz   42 KB    │   │
│  │ users_20260519_120000.json.gz   18 KB    │   │
│  │ system_20260519_060000.tar.gz   41 KB    │   │
│  │ users_20260519_060000.json.gz   17 KB    │   │
│  └──────────────────────────────────────────┘   │
│                                                  │
│  [🔄 Backup Now]  [📥 Download]  [⬆️ Restore]   │
│                                                  │
│  ─── Settings ───                               │
│  Interval (hours):  [6]                          │
│  rclone remote:     [gdrive]                    │
│  rclone path:       [sa-helper-backups]         │
│  TG backup chat ID: [-1001234567890]            │
│  Keep local copies: [20]                        │
└─────────────────────────────────────────────────┘
```

### 7. Admin API Routes

```python
# backend/app/api/admin_routes/backups.py (expand existing)

@router.post("/api/backups/system")
async def create_system_backup(request):
    path = container.backup_service.create_system_backup()
    return {"ok": True, "file": path.name, "size": path.stat().st_size}

@router.post("/api/backups/users")
async def create_user_backup(request):
    path = container.backup_service.create_user_backup()
    return {"ok": True, "file": path.name, "size": path.stat().st_size}

@router.post("/api/backups/rclone-sync")
async def rclone_sync_all(request):
    results = container.backup_service.rclone_sync_latest()
    return {"ok": True, "results": results}

@router.get("/api/backups/list")
async def list_backups(request):
    return container.backup_service.list_all_backups()

@router.post("/api/backups/restore")
async def restore_backup(request):
    body = await request.json()
    backup_type = body["type"]  # "system" or "users"
    filename = body["filename"]
    result = container.backup_service.restore(backup_type, filename)
    return {"ok": True, "restored": result}
```

---

## rclone Setup (Docker)

**Add to Dockerfile**:
```dockerfile
RUN curl -O https://downloads.rclone.org/current/rclone-current-linux-arm64.deb \
    && dpkg -i rclone-current-linux-arm64.deb \
    && rm rclone-current-linux-arm64.deb
```

**Configure on VPS** (one-time):
```bash
# Interactive config (run once, saves to /root/.config/rclone/rclone.conf)
docker exec -it sa-helper rclone config

# Or mount host rclone config:
volumes:
  - /root/.config/rclone:/root/.config/rclone:ro
```

---

## Admin Settings (platform_settings)

| Setting Key | Default | Description |
|-------------|---------|-------------|
| `backup.interval_hours` | `6` | Hours between automated backups |
| `backup.rclone_remote` | `` | rclone remote name (e.g., `gdrive`) |
| `backup.rclone_path` | `sa-helper-backups` | Remote folder path |
| `backup.telegram_chat_id` | `` | TG channel/group for backup uploads |
| `backup.keep_local` | `20` | Max local backup files to keep |
| `backup.enabled` | `true` | Enable/disable automated backups |

---

## Files to Change

| File | Change |
|------|--------|
| `backend/app/services/backup_service.py` | Major expansion — add system/user split, rclone, Telegram |
| `backend/app/main.py` | Add `_backup_scheduler` background task |
| `backend/app/api/admin_routes/backups.py` | Add system/user/rclone/restore endpoints |
| `backend/app/core/container.py` | Wire expanded BackupService |
| `Dockerfile` | Install rclone |
| `docker-compose.prod.yml` | Mount rclone config volume |
| `frontend/src/app/components/SettingsPanel.jsx` | Add backup settings section |
