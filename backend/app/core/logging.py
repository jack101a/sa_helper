"""Structured logging utilities."""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone

from app.core.config import Settings


class JsonFormatter(logging.Formatter):
    """Convert log records into JSON."""

    def format(self, record: logging.LogRecord) -> str:
        """Return JSON-serialized log payload."""

        payload = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        if hasattr(record, "context"):
            payload["context"] = record.context
        return json.dumps(payload, ensure_ascii=True)


def configure_logging(settings: Settings) -> None:
    """Initialize root logger based on settings."""

    root = logging.getLogger()
    root.handlers.clear()
    root.setLevel(settings.logging.level.upper())
    handler = logging.StreamHandler()
    if settings.logging.json_logs:
        handler.setFormatter(JsonFormatter())
    else:
        handler.setFormatter(
            logging.Formatter("%(asctime)s | %(levelname)s | %(name)s | %(message)s")
        )
    root.addHandler(handler)
