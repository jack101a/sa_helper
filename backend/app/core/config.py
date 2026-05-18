"""Configuration loader — Unified Platform (captcha + exam + autofill)."""

from __future__ import annotations

import os
from copy import deepcopy
from functools import lru_cache
from pathlib import Path
from typing import Any
from urllib.parse import quote

import yaml
from dotenv import load_dotenv
from pydantic import BaseModel, Field, field_validator

from app.core.paths import get_project_root

_DEFAULT_CONFIG: dict[str, Any] = {
    "app_name": "unified-platform",
    "server": {
        "host": "0.0.0.0",
        "port": 8080,
        "debug": False,
        "cors_origins": ["moz-extension://*", "chrome-extension://*"],
        "cors_origin_regex": "^(moz-extension|chrome-extension)://.*$",
    },
    "auth": {
        "key_prefix": "sk-",
        "key_length": 32,
        "default_expiry_days": 90,
        "hash_salt": "",
        "admin_token": "",
        "admin_username": "admin",
        "admin_password": "",
    },
    "rate_limit": {"requests_per_minute": 60, "burst": 10},
    "queue": {"workers": 4, "max_pending_jobs": 500, "cache_ttl_seconds": 300},
    "logging": {"level": "INFO", "debug": False, "json": True},
    "model": {
        "default": "onnx",
        "fallback": "onnx",
        "allow_future_model": False,
        "onnx_path": "data/models/model.onnx",
        "onnx_vocab": "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
        "onnx_height": 54,
        "onnx_width": 250,
    },
    "storage": {
        "sqlite_path": "backend/logs/app.db",
        "database_url": "",
        "db_type": "postgresql",
        "import_path": "import",
        "postgres_db": "sa_helper",
        "postgres_user": "sa_helper",
        "postgres_password": "",
        "postgres_host": "postgres",
        "postgres_port": "5432",
    },
    "redis": {"enabled": False, "url": "redis://localhost:6379/0", "prefix": "up:"},
    "solve": {"backend": "inprocess"},
    "retrain": {"worker_enabled": False},
    # ── Exam service config ────────────────────────────────────────────────────
    "exam": {
        "litellm_endpoint": "",       # e.g. https://llm.example.com/v1/chat/completions
        "litellm_api_key": "",
        "litellm_model": "gemma-4-31b-it_gemini",
        "ocr_lang": "eng+hin",        # pytesseract language
        "ocr_concurrency": 2,          # max concurrent Tesseract calls per API worker
        "tessdata_path": "backend/tessdata",  # path to .traineddata files
        "question_data_path": "data/questions/questions.json",
        "sign_hashes_path": "data/hashes/sign_hashes.json",
        "sign_labels_path": "data/hashes/sign_label.json",
    },
    # ── WhatsApp admin alert ───────────────────────────────────────────────────
    "alerts": {
        "whatsapp_enabled": False,
        "callmebot_phone": "",        # E.164 format: +91xxxxxxxxxx
        "callmebot_apikey": "",
    },
    # ── Telegram bot ────────────────────────────────────────────────────────────
    "telegram": {
        "bot_token": "",              # from @BotFather
        "bot_enabled": False,
        "api_base_url": "https://api.telegram.org",
    },
    # ── Payments ──────────────────────────────────────────────────────────────
    "payment": {
        "upi_id": "",                 # e.g. yourname@upi
        "qr_image_url": "",           # hosted QR code image URL
    },
}


class ServerConfig(BaseModel):
    host: str
    port: int
    debug: bool = False
    cors_origins: list[str] = Field(default_factory=list)
    cors_origin_regex: str | None = None


class AuthConfig(BaseModel):
    hash_salt: str
    admin_token: str
    admin_username: str = ""
    admin_password: str = ""
    key_prefix: str = "sk-"
    key_length: int = 32
    default_expiry_days: int = 90

    @field_validator("hash_salt")
    @classmethod
    def hash_salt_must_not_be_empty(cls, v: str) -> str:
        token = v.strip()
        if not token:
            raise ValueError(
                "AUTH_HASH_SALT must not be empty — set it in your .env file. "
                "An empty salt makes all API keys trivially equivalent."
            )
        if token.lower() in {"change-me", "changeme", "replace-me", "replace_with_strong_random_value"}:
            raise ValueError("AUTH_HASH_SALT uses an insecure placeholder; set a strong random value.")
        return v

    @field_validator("admin_token")
    @classmethod
    def admin_token_must_not_be_empty(cls, v: str) -> str:
        token = v.strip()
        if not token:
            raise ValueError(
                "ADMIN_TOKEN must not be empty — set it in your .env file. "
                "An empty token allows unauthenticated admin access."
            )
        if token.lower() in {"change-me", "changeme", "replace-me", "replace_with_strong_random_value"}:
            raise ValueError("ADMIN_TOKEN uses an insecure placeholder; set a strong random value.")
        return v

    @field_validator("admin_password")
    @classmethod
    def admin_password_must_not_be_placeholder(cls, v: str) -> str:
        token = str(v or "").strip()
        if token.lower() in {"change-me", "changeme", "replace-me", "replace_with_strong_random_value"}:
            raise ValueError("ADMIN_PASSWORD uses an insecure placeholder; set a strong password.")
        return v


class RateLimitConfig(BaseModel):
    requests_per_minute: int = 60
    burst: int = 10


class QueueConfig(BaseModel):
    workers: int = 4
    max_pending_jobs: int = 500
    cache_ttl_seconds: int = 300


class LoggingConfig(BaseModel):
    model_config = {"populate_by_name": True}

    level: str = "INFO"
    debug: bool = False
    # The YAML key is "json"; we expose it as json_logs in Python code.
    json_logs: bool = Field(default=True, alias="json")


class ModelConfig(BaseModel):
    default: str = "onnx"
    fallback: str = "onnx"
    allow_future_model: bool = False
    onnx_path: str = ""
    onnx_vocab: str = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
    onnx_height: int = 54
    onnx_width: int = 250


class StorageConfig(BaseModel):
    sqlite_path: str
    # PostgreSQL support (used when DB_TYPE=postgresql)
    database_url: str = ""
    db_type: str = "sqlite"  # "sqlite" | "postgresql"
    import_path: str = "import"
    postgres_db: str = "sa_helper"
    postgres_user: str = "sa_helper"
    postgres_password: str = ""
    postgres_host: str = "postgres"
    postgres_port: str = "5432"

    @field_validator("db_type")
    @classmethod
    def validate_db_type(cls, v: str) -> str:
        if v not in ("sqlite", "postgresql"):
            raise ValueError(f"db_type must be 'sqlite' or 'postgresql', got '{v}'")
        return v

    @field_validator("postgres_password")
    @classmethod
    def validate_postgres_password(cls, v: str) -> str:
        token = str(v or "").strip()
        if token.lower() in {"change-me", "changeme", "replace-me", "replace_with_strong_random_value"}:
            raise ValueError("POSTGRES_PASSWORD uses an insecure placeholder; set a real password.")
        return v


class RedisConfig(BaseModel):
    enabled: bool = False
    url: str = "redis://localhost:6379/0"
    prefix: str = "up:"  # key prefix for namespacing


class RetrainConfig(BaseModel):
    worker_enabled: bool = False


class ExamConfig(BaseModel):
    litellm_endpoint: str = ""
    litellm_api_key: str = ""
    litellm_model: str = "gemma-4-31b-it_gemini"
    ocr_lang: str = "eng+hin"
    ocr_concurrency: int = 2
    tessdata_path: str = "backend/tessdata"
    question_data_path: str = "data/questions/questions.json"
    sign_hashes_path: str = "data/hashes/sign_hashes.json"
    sign_labels_path: str = "data/hashes/sign_label.json"


class AlertsConfig(BaseModel):
    whatsapp_enabled: bool = False
    callmebot_phone: str = ""
    callmebot_apikey: str = ""


class TelegramConfig(BaseModel):
    bot_token: str = ""
    bot_enabled: bool = False
    api_base_url: str = "https://api.telegram.org"


class PaymentConfig(BaseModel):
    upi_id: str = ""
    qr_image_url: str = ""


class Settings(BaseModel):
    app_name: str = "unified-platform"
    server: ServerConfig
    auth: AuthConfig
    rate_limit: RateLimitConfig
    queue: QueueConfig
    logging: LoggingConfig
    model: ModelConfig
    storage: StorageConfig
    redis: RedisConfig = Field(default_factory=RedisConfig)
    solve: dict[str, str] = Field(default_factory=lambda: {"backend": "inprocess"})
    retrain: RetrainConfig = Field(default_factory=RetrainConfig)
    exam: ExamConfig = Field(default_factory=ExamConfig)
    alerts: AlertsConfig = Field(default_factory=AlertsConfig)
    telegram: TelegramConfig = Field(default_factory=TelegramConfig)
    payment: PaymentConfig = Field(default_factory=PaymentConfig)


def _read_yaml_config(config_path: Path) -> dict[str, Any]:
    if not config_path.exists():
        try:
            config_path.parent.mkdir(parents=True, exist_ok=True)
            config_path.write_text(yaml.safe_dump(_DEFAULT_CONFIG, sort_keys=False), encoding="utf-8")
        except Exception as exc:
            # Log to stderr rather than swallowing silently
            import sys
            print(f"WARNING: could not write default config to {config_path}: {exc}", file=sys.stderr)
        return deepcopy(_DEFAULT_CONFIG)
    with config_path.open("r", encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def _deep_merge(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    merged = deepcopy(base)
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = _deep_merge(merged[key], value)
        else:
            merged[key] = value
    return merged


def _resolve_path(raw_path: str) -> Path:
    return (get_project_root() / raw_path).resolve()


def _env_or_default(name: str, default: str) -> str:
    value = os.getenv(name)
    if value is None:
        return default
    value = value.strip()
    return value if value else default


def _postgres_url_from_values(
    database: str,
    user: str,
    password: str,
    host: str,
    port: str,
) -> str:
    database = database.strip() or "sa_helper"
    user = user.strip() or "sa_helper"
    password = password.strip()
    host = host.strip() or "postgres"
    port = port.strip() or "5432"
    if not password:
        return ""
    return (
        f"postgresql+psycopg2://{quote(user, safe='')}:"
        f"{quote(password, safe='')}@{host}:{port}/{database}"
    )


@lru_cache
def get_settings() -> Settings:
    project_root = get_project_root()
    load_dotenv(project_root / "config" / ".env")
    raw_config = os.getenv("CONFIG_PATH", "backend/config/config.yaml")
    config_path = (project_root / raw_config).resolve()
    config_dict = _deep_merge(_DEFAULT_CONFIG, _read_yaml_config(config_path))

    # Env overrides
    config_dict.setdefault("auth", {})
    config_dict["auth"]["hash_salt"]       = os.getenv("AUTH_HASH_SALT",   config_dict["auth"].get("hash_salt", ""))
    config_dict["auth"]["admin_token"]     = os.getenv("ADMIN_TOKEN",      config_dict["auth"].get("admin_token", ""))
    config_dict["auth"]["admin_username"]  = os.getenv("ADMIN_USERNAME",   config_dict["auth"].get("admin_username", ""))
    config_dict["auth"]["admin_password"]  = os.getenv("ADMIN_PASSWORD",   config_dict["auth"].get("admin_password", ""))

    config_dict.setdefault("storage", {})
    sqlite_raw = os.getenv("SQLITE_PATH", config_dict["storage"].get("sqlite_path", ""))
    config_dict["storage"]["sqlite_path"] = str(_resolve_path(sqlite_raw))
    import_raw = config_dict["storage"].get("import_path", "import")
    config_dict["storage"]["import_path"] = str(_resolve_path(import_raw))
    config_dict["storage"]["postgres_db"] = _env_or_default(
        "POSTGRES_DB",
        str(config_dict["storage"].get("postgres_db", "sa_helper")),
    )
    config_dict["storage"]["postgres_user"] = _env_or_default(
        "POSTGRES_USER",
        str(config_dict["storage"].get("postgres_user", "sa_helper")),
    )
    config_dict["storage"]["postgres_password"] = _env_or_default(
        "POSTGRES_PASSWORD",
        str(config_dict["storage"].get("postgres_password", "")),
    )
    config_dict["storage"]["postgres_host"] = _env_or_default(
        "POSTGRES_HOST",
        str(config_dict["storage"].get("postgres_host", "postgres")),
    )
    config_dict["storage"]["postgres_port"] = _env_or_default(
        "POSTGRES_PORT",
        str(config_dict["storage"].get("postgres_port", "5432")),
    )
    config_dict["storage"]["db_type"] = os.getenv("DB_TYPE", config_dict["storage"].get("db_type", "postgresql")).lower()
    database_url = os.getenv("DATABASE_URL", config_dict["storage"].get("database_url", ""))
    if config_dict["storage"]["db_type"] == "postgresql" and not database_url:
        database_url = _postgres_url_from_values(
            database=config_dict["storage"]["postgres_db"],
            user=config_dict["storage"]["postgres_user"],
            password=config_dict["storage"]["postgres_password"],
            host=config_dict["storage"]["postgres_host"],
            port=config_dict["storage"]["postgres_port"],
        )
    config_dict["storage"]["database_url"] = database_url

    config_dict.setdefault("redis", {})
    config_dict["redis"]["enabled"] = os.getenv("REDIS_ENABLED", str(config_dict["redis"].get("enabled", False))).lower() in ("1", "true", "yes")
    config_dict["redis"]["url"] = os.getenv("REDIS_URL", config_dict["redis"].get("url", "redis://localhost:6379/0"))
    config_dict.setdefault("solve", {})
    solve_backend = os.getenv("SOLVE_BACKEND", str(config_dict["solve"].get("backend", "inprocess"))).strip().lower()
    if solve_backend not in {"inprocess", "celery_sync", "celery_async"}:
        solve_backend = "inprocess"
    config_dict["solve"]["backend"] = solve_backend

    config_dict.setdefault("model", {})
    onnx_raw = os.getenv("ONNX_PATH", config_dict["model"].get("onnx_path", ""))
    if onnx_raw:
        config_dict["model"]["onnx_path"] = str(_resolve_path(onnx_raw))

    config_dict.setdefault("exam", {})
    config_dict["exam"]["litellm_endpoint"] = os.getenv("LITELLM_ENDPOINT", config_dict["exam"].get("litellm_endpoint", ""))
    config_dict["exam"]["litellm_api_key"]  = os.getenv("LITELLM_API_KEY",  config_dict["exam"].get("litellm_api_key", ""))
    config_dict["exam"]["ocr_concurrency"] = int(os.getenv("EXAM_OCR_CONCURRENCY", config_dict["exam"].get("ocr_concurrency", 2)))

    config_dict.setdefault("queue", {})
    config_dict["queue"]["workers"] = int(os.getenv("QUEUE_WORKERS", config_dict["queue"].get("workers", 4)))

    config_dict.setdefault("alerts", {})
    config_dict["alerts"]["callmebot_phone"]  = os.getenv("CALLMEBOT_PHONE",  config_dict["alerts"].get("callmebot_phone", ""))
    config_dict["alerts"]["callmebot_apikey"] = os.getenv("CALLMEBOT_APIKEY", config_dict["alerts"].get("callmebot_apikey", ""))

    config_dict.setdefault("telegram", {})
    config_dict["telegram"]["bot_token"]   = os.getenv("TELEGRAM_BOT_TOKEN", config_dict["telegram"].get("bot_token", ""))
    config_dict["telegram"]["bot_enabled"] = os.getenv("TELEGRAM_BOT_ENABLED", str(config_dict["telegram"].get("bot_enabled", False))).lower() in ("1", "true", "yes")
    config_dict["telegram"]["api_base_url"] = os.getenv("TELEGRAM_API_BASE_URL", config_dict["telegram"].get("api_base_url", "https://api.telegram.org"))

    config_dict.setdefault("server", {})
    config_dict["server"]["debug"] = os.getenv("DEBUG", str(config_dict["server"].get("debug", False))).lower() in {"1", "true", "yes"}

    config_dict.setdefault("retrain", {})
    config_dict["retrain"]["worker_enabled"] = os.getenv(
        "RETRAIN_WORKER_ENABLED", str(config_dict["retrain"].get("worker_enabled", False))
    ).lower() in {"1", "true", "yes"}

    config_dict.setdefault("logging", {})
    config_dict["logging"]["debug"] = config_dict["server"]["debug"]
    if config_dict["server"]["debug"]:
        config_dict["logging"]["level"] = "DEBUG"

    return Settings(**config_dict)
