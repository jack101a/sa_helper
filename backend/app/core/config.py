"""Configuration loader — Unified Platform (captcha + exam + autofill)."""

from __future__ import annotations

import os
from copy import deepcopy
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml
from dotenv import load_dotenv
from pydantic import BaseModel, Field

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
    "queue": {"workers": 2, "max_pending_jobs": 500, "cache_ttl_seconds": 300},
    "logging": {"level": "INFO", "debug": False, "json": True},
    "model": {
        "default": "onnx",
        "fallback": "onnx",
        "allow_future_model": False,
        "onnx_path": "backend/models/model.onnx",
        "onnx_vocab": "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
        "onnx_height": 54,
        "onnx_width": 250,
    },
    "storage": {"sqlite_path": "backend/logs/app.db"},
    "retrain": {"worker_enabled": False},
    # ── NEW: Exam service config ───────────────────────────────────────────────
    "exam": {
        "litellm_endpoint": "",       # e.g. https://llm.example.com/v1/chat/completions
        "litellm_api_key": "",
        "litellm_model": "gemma-4-31b-it_gemini",
        "ocr_lang": "eng+hin",        # pytesseract language
        "tessdata_path": "backend/tessdata",  # path to .traineddata files
        "question_data_path": "backend/app/data/questions.json",
        "sign_hashes_path": "backend/app/data/sign_hashes.json",
        "sign_labels_path": "backend/app/data/sign_label.json",
    },
    # ── NEW: WhatsApp admin alert ──────────────────────────────────
    "alerts": {
        "whatsapp_enabled": False,
        "callmebot_phone": "",        # E.164 format: +91xxxxxxxxxx
        "callmebot_apikey": "",
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


class RateLimitConfig(BaseModel):
    requests_per_minute: int = 60
    burst: int = 10


class QueueConfig(BaseModel):
    workers: int = 2
    max_pending_jobs: int = 500
    cache_ttl_seconds: int = 300


class LoggingConfig(BaseModel):
    level: str = "INFO"
    debug: bool = False
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


class RetrainConfig(BaseModel):
    worker_enabled: bool = False


class ExamConfig(BaseModel):
    litellm_endpoint: str = ""
    litellm_api_key: str = ""
    litellm_model: str = "gemma-4-31b-it_gemini"
    ocr_lang: str = "eng+hin"
    question_data_path: str = "backend/app/data/questions.json"
    sign_hashes_path: str = "backend/app/data/sign_hashes.json"
    sign_labels_path: str = "backend/app/data/sign_label.json"


class AlertsConfig(BaseModel):
    whatsapp_enabled: bool = False
    callmebot_phone: str = ""
    callmebot_apikey: str = ""


class Settings(BaseModel):
    app_name: str = "unified-platform"
    server: ServerConfig
    auth: AuthConfig
    rate_limit: RateLimitConfig
    queue: QueueConfig
    logging: LoggingConfig
    model: ModelConfig
    storage: StorageConfig
    retrain: RetrainConfig = Field(default_factory=RetrainConfig)
    exam: ExamConfig = Field(default_factory=ExamConfig)
    alerts: AlertsConfig = Field(default_factory=AlertsConfig)


def _read_yaml_config(config_path: Path) -> dict[str, Any]:
    if not config_path.exists():
        try:
            config_path.parent.mkdir(parents=True, exist_ok=True)
            config_path.write_text(yaml.safe_dump(_DEFAULT_CONFIG, sort_keys=False), encoding="utf-8")
        except Exception:
            pass
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


def _get_project_root() -> Path:
    return Path(__file__).resolve().parents[3]


def _resolve_path(raw_path: str) -> Path:
    return (_get_project_root() / raw_path).resolve()


@lru_cache
def get_settings() -> Settings:
    project_root = _get_project_root()
    load_dotenv(project_root / ".env")
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

    config_dict.setdefault("model", {})
    onnx_raw = os.getenv("ONNX_PATH", config_dict["model"].get("onnx_path", ""))
    if onnx_raw:
        config_dict["model"]["onnx_path"] = str(_resolve_path(onnx_raw))

    config_dict.setdefault("exam", {})
    config_dict["exam"]["litellm_endpoint"] = os.getenv("LITELLM_ENDPOINT", config_dict["exam"].get("litellm_endpoint", ""))
    config_dict["exam"]["litellm_api_key"]  = os.getenv("LITELLM_API_KEY",  config_dict["exam"].get("litellm_api_key", ""))

    config_dict.setdefault("alerts", {})
    config_dict["alerts"]["callmebot_phone"]  = os.getenv("CALLMEBOT_PHONE",  config_dict["alerts"].get("callmebot_phone", ""))
    config_dict["alerts"]["callmebot_apikey"] = os.getenv("CALLMEBOT_APIKEY", config_dict["alerts"].get("callmebot_apikey", ""))

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
