"""Async solve queue, worker pool, and fallback behavior."""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass
from typing import Any

from app.services.cache_service import CacheService
from app.services.model_router import ModelRouter

logger = logging.getLogger(__name__)


@dataclass
class SolveJob:
    """Queued solve job."""

    task_type: str
    payload_base64: str
    mode: str
    domain: str | None
    field_name: str | None
    future: asyncio.Future


class SolverService:
    """Queue-based solver with in-memory cache."""

    def __init__(
        self,
        workers: int,
        max_pending_jobs: int,
        model_router: ModelRouter,
        cache: CacheService,
    ) -> None:
        self._workers = workers
        self._queue: asyncio.Queue[SolveJob] = asyncio.Queue(maxsize=max_pending_jobs)
        self._model_router = model_router
        self._cache = cache
        self._worker_tasks: list[asyncio.Task] = []

    async def start(self) -> None:
        """Spawn worker tasks."""

        for index in range(self._workers):
            task = asyncio.create_task(self._worker_loop(index))
            self._worker_tasks.append(task)

    async def stop(self) -> None:
        """Cancel worker tasks."""

        for task in self._worker_tasks:
            task.cancel()
        await asyncio.gather(*self._worker_tasks, return_exceptions=True)
        self._worker_tasks.clear()

    async def submit(
        self,
        task_type: str,
        payload_base64: str,
        mode: str,
        domain: str | None = None,
        field_name: str | None = None,
    ) -> dict[str, Any]:
        """Resolve from cache or queue request for workers."""

        cached = self._cache.get(
            task_type,
            payload_base64,
            mode,
            domain=domain,
            field_name=field_name,
        )
        if cached:
            logger.info(
                "solve_cache_hit",
                extra={
                    "context": {
                        "task_type": task_type,
                        "mode": mode,
                        "domain": domain,
                        "field_name": field_name,
                    }
                },
            )
            return {
                "result": cached["result"],
                "processing_ms": 0,
                "model_used": cached.get("model_used", "cache"),
                "cached": True,
            }
        logger.info(
            "solve_enqueued",
            extra={
                "context": {
                    "task_type": task_type,
                    "mode": mode,
                    "domain": domain,
                    "field_name": field_name,
                }
            },
        )
        loop = asyncio.get_event_loop()
        future: asyncio.Future = loop.create_future()
        await self._queue.put(
            SolveJob(
                task_type=task_type,
                payload_base64=payload_base64,
                mode=mode,
                domain=domain,
                field_name=field_name,
                future=future,
            )
        )
        return await future

    async def _worker_loop(self, worker_id: int) -> None:
        """Process jobs from queue forever."""

        while True:
            job = await self._queue.get()
            started = time.perf_counter()
            try:
                logger.info(
                    "model_execution_start",
                    extra={
                        "context": {
                            "worker_id": worker_id,
                            "task_type": job.task_type,
                            "mode": job.mode,
                            "domain": job.domain,
                            "field_name": job.field_name,
                        }
                    },
                )
                
                # ModelRouter now returns a dict with 'result' and 'model_used'
                routing_result = await self._model_router.solve(
                    task_type=job.task_type,
                    payload_base64=job.payload_base64,
                    mode=job.mode,
                    domain=job.domain,
                    field_name=job.field_name,
                )
                
                elapsed = int((time.perf_counter() - started) * 1000)
                logger.info(
                    "model_execution_end",
                    extra={
                        "context": {
                            "worker_id": worker_id,
                            "task_type": job.task_type,
                            "mode": job.mode,
                            "processing_ms": elapsed,
                            "model_used": routing_result["model_used"],
                            "field_name": job.field_name,
                        }
                    },
                )
                payload = {
                    "result": routing_result["result"],
                    "processing_ms": elapsed,
                    "model_used": routing_result["model_used"],
                    "cached": False
                }
                self._cache.set(
                    job.task_type,
                    job.payload_base64,
                    job.mode,
                    payload,
                    domain=job.domain,
                    field_name=job.field_name,
                )
                job.future.set_result(payload)
            except Exception as error:
                logger.exception(
                    "worker_failed",
                    extra={"context": {"worker": worker_id, "error": str(error)}},
                )
                if not job.future.done():
                    job.future.set_exception(error)
            finally:
                self._queue.task_done()
