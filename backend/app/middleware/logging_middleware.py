"""Request logging middleware."""

from __future__ import annotations

import logging
import time

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware

logger = logging.getLogger("request")


class LoggingMiddleware(BaseHTTPMiddleware):
    """Log request metadata and duration."""

    async def dispatch(self, request: Request, call_next):
        """Log request after response completes."""

        started = time.perf_counter()
        ip = request.client.host if request.client else "unknown"
        logger.info(
            "request_incoming",
            extra={
                "context": {
                    "method": request.method,
                    "path": request.url.path,
                    "ip": ip,
                }
            },
        )
        response = await call_next(request)
        elapsed = int((time.perf_counter() - started) * 1000)
        logger.info(
            "request_complete",
            extra={
                "context": {
                    "method": request.method,
                    "path": request.url.path,
                    "status": response.status_code,
                    "ip": ip,
                    "elapsed_ms": elapsed,
                }
            },
        )
        return response
