"""In-memory per-key + IP rate limiting middleware."""

from __future__ import annotations

import time
from collections import defaultdict, deque

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.config import Settings


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Rate-limit keyed by API key + IP address."""

    def __init__(self, app, settings: Settings) -> None:
        super().__init__(app)
        self._rpm = settings.rate_limit.requests_per_minute
        self._burst = max(0, int(settings.rate_limit.burst))
        self._window_seconds = 60
        self._events: dict[str, deque[float]] = defaultdict(deque)

    async def dispatch(self, request: Request, call_next):
        """Reject requests that exceed window quota."""

        if not request.url.path.startswith("/v1"):
            return await call_next(request)
        if request.url.path in {"/v1/key/create", "/v1/key/revoke"}:
            return await call_next(request)

        key_record = getattr(request.state, "api_key_record", None)
        api_key = getattr(request.state, "api_key", "anonymous")
        ip = request.client.host if request.client else "unknown"
        key_id = int(key_record.get("id")) if key_record else None
        global_bucket = f"global:{ip}"
        key_bucket = f"key:{api_key}:{ip}:{key_id if key_id is not None else 'unknown'}"
        now = time.time()

        # Global limiter (all API traffic).
        global_queue = self._events[global_bucket]
        while global_queue and (now - global_queue[0]) > self._window_seconds:
            global_queue.popleft()
        if len(global_queue) >= (self._rpm + self._burst):
            return JSONResponse({"detail": "rate limit exceeded"}, status_code=429)
        global_queue.append(now)

        # Per-key limiter with optional DB override.
        key_rpm = self._rpm
        key_burst = self._burst
        container = getattr(request.app.state, "container", None)
        if key_id is not None and container is not None:
            custom = container.db.get_api_key_rate_limit(key_id)
            if custom:
                key_rpm = int(custom.get("requests_per_minute", key_rpm))
                key_burst = int(custom.get("burst", key_burst))

        key_queue = self._events[key_bucket]
        while key_queue and (now - key_queue[0]) > self._window_seconds:
            key_queue.popleft()
        if len(key_queue) >= (key_rpm + key_burst):
            return JSONResponse({"detail": "api key rate limit exceeded"}, status_code=429)
        key_queue.append(now)

        return await call_next(request)
