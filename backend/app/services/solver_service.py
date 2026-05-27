"""Async solve queue, worker pool, and fallback behavior."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
import uuid
from dataclasses import dataclass
from typing import Any

from fastapi import HTTPException
from redis import asyncio as redis_async

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
        self._queue_backend = os.getenv("SOLVER_QUEUE_BACKEND", os.getenv("SOLVER_QUEUE_MODE", "inprocess")).strip().lower()
        self._redis_url = os.getenv("REDIS_URL", "").strip()
        self._redis_prefix = os.getenv("REDIS_PREFIX", os.getenv("SOLVER_REDIS_PREFIX", "sa_helper:")).strip() or "sa_helper:"
        self._job_timeout_seconds = max(1, int(os.getenv("SOLVER_JOB_TIMEOUT_SECONDS", "30") or "30"))
        self._fallback_local = os.getenv("SOLVER_QUEUE_FALLBACK_LOCAL", "true").strip().lower() in {"1", "true", "yes", "on"}
        self._redis: redis_async.Redis | None = None

    @property
    def redis_queue_key(self) -> str:
        return f"{self._redis_prefix}solver:queue"

    def redis_result_key(self, request_id: str) -> str:
        return f"{self._redis_prefix}solver:result:{request_id}"

    def uses_remote_queue(self) -> bool:
        return self._queue_backend in {"redis", "distributed", "remote"}

    async def _redis_client(self) -> redis_async.Redis:
        if not self._redis_url:
            raise RuntimeError("REDIS_URL is required when SOLVER_QUEUE_BACKEND=redis")
        if self._redis is None:
            self._redis = redis_async.from_url(self._redis_url, decode_responses=True)
        return self._redis

    async def start(self) -> None:
        """Spawn worker tasks."""

        if self.uses_remote_queue():
            logger.info("solver_remote_queue_enabled", extra={"context": {"backend": self._queue_backend}})
            return
        for index in range(self._workers):
            task = asyncio.create_task(self._worker_loop(index))
            self._worker_tasks.append(task)

    async def stop(self) -> None:
        """Cancel worker tasks and drain in-flight futures."""

        for task in self._worker_tasks:
            task.cancel()
        await asyncio.gather(*self._worker_tasks, return_exceptions=True)
        self._worker_tasks.clear()

        # Reject any jobs still sitting in the queue so callers don't hang
        while not self._queue.empty():
            try:
                job = self._queue.get_nowait()
                if not job.future.done():
                    job.future.set_exception(RuntimeError("Server shutting down"))
                self._queue.task_done()
            except asyncio.QueueEmpty:
                break
        if self._redis is not None:
            await self._redis.aclose()
            self._redis = None

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
        if self.uses_remote_queue():
            try:
                return await self._submit_remote(
                    task_type=task_type,
                    payload_base64=payload_base64,
                    mode=mode,
                    domain=domain,
                    field_name=field_name,
                )
            except Exception as error:
                if not self._fallback_local:
                    raise
                logger.warning(
                    "solve_remote_queue_fallback_local",
                    extra={
                        "context": {
                            "task_type": task_type,
                            "domain": domain,
                            "field_name": field_name,
                            "error": str(error),
                        }
                    },
                )
                return await self.solve_direct(
                    task_type=task_type,
                    payload_base64=payload_base64,
                    mode=mode,
                    domain=domain,
                    field_name=field_name,
                )
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
        loop = asyncio.get_running_loop()  # Replaces deprecated get_event_loop()
        future: asyncio.Future = loop.create_future()

        try:
            self._queue.put_nowait(
                SolveJob(
                    task_type=task_type,
                    payload_base64=payload_base64,
                    mode=mode,
                    domain=domain,
                    field_name=field_name,
                    future=future,
                )
            )
        except asyncio.QueueFull:
            # Return 503 immediately rather than blocking the caller indefinitely
            raise HTTPException(status_code=503, detail="Solver queue full — try again shortly")

        return await future

    async def _submit_remote(
        self,
        task_type: str,
        payload_base64: str,
        mode: str,
        domain: str | None = None,
        field_name: str | None = None,
    ) -> dict[str, Any]:
        """Submit a solve job to Redis and wait for a worker result."""

        client = await self._redis_client()
        request_id = uuid.uuid4().hex
        result_key = self.redis_result_key(request_id)
        job = {
            "request_id": request_id,
            "task_type": task_type,
            "payload_base64": payload_base64,
            "mode": mode,
            "domain": domain,
            "field_name": field_name,
            "model_filename": self._model_router.resolve_model_filename(task_type, domain=domain, field_name=field_name),
            "queued_at": time.time(),
        }
        await client.rpush(self.redis_queue_key, json.dumps(job, separators=(",", ":")))
        await client.expire(result_key, self._job_timeout_seconds + 30)
        logger.info("solve_enqueued_remote", extra={"context": {"request_id": request_id, "task_type": task_type, "domain": domain, "field_name": field_name}})

        item = await client.blpop(result_key, timeout=self._job_timeout_seconds)
        if not item:
            raise HTTPException(status_code=504, detail="Solver worker timeout")
        _key, raw = item
        await client.delete(result_key)
        data = json.loads(raw)
        if data.get("status") != "ok":
            raise RuntimeError(str(data.get("error") or "worker failed"))
        payload = data.get("payload")
        if not isinstance(payload, dict):
            raise RuntimeError("worker returned invalid payload")
        self._cache.set(
            task_type,
            payload_base64,
            mode,
            payload,
            domain=domain,
            field_name=field_name,
        )
        return payload

    async def solve_direct(
        self,
        task_type: str,
        payload_base64: str,
        mode: str,
        domain: str | None = None,
        field_name: str | None = None,
        model_filename: str | None = None,
    ) -> dict[str, Any]:
        """Run one solve directly, used by standalone worker processes."""

        started = time.perf_counter()
        routing_result = await self._model_router.solve(
            task_type=task_type,
            payload_base64=payload_base64,
            mode=mode,
            domain=domain,
            field_name=field_name,
            model_filename=model_filename,
        )
        elapsed = int((time.perf_counter() - started) * 1000)
        payload = {
            "result": routing_result["result"],
            "processing_ms": elapsed,
            "model_used": routing_result["model_used"],
            "cached": False,
        }
        self._cache.set(
            task_type,
            payload_base64,
            mode,
            payload,
            domain=domain,
            field_name=field_name,
        )
        return payload

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

                payload = await self.solve_direct(
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
                            "model_used": payload["model_used"],
                            "field_name": job.field_name,
                        }
                    },
                )
                job.future.set_result(payload)
            except asyncio.CancelledError:
                if not job.future.done():
                    job.future.set_exception(asyncio.CancelledError())
                raise
            except Exception as error:
                logger.exception(
                    "worker_failed",
                    extra={"context": {"worker": worker_id, "error": str(error)}},
                )
                if not job.future.done():
                    job.future.set_exception(error)
            finally:
                self._queue.task_done()
