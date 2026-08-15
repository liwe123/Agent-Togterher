from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta
from typing import Any

import redis.asyncio as redis

from app.db.base import utc_now

logger = logging.getLogger(__name__)


async def _maybe_await(value: Any) -> Any:
    if asyncio.iscoroutine(value) or asyncio.isfuture(value):
        return await value
    return value


class WorkerRegistry:
    """Track live worker instances via Redis heartbeats.

    Each worker writes its own heartbeat key with an expiry equal to
    the lease timeout.  A background sweep removes stale keys so that
    the registry always reflects the currently-alive instances.
    """

    WORKER_HEARTBEAT_PREFIX = "agent_console:worker:heartbeat:"
    WORKER_INFO_PREFIX = "agent_console:worker:info:"
    LOCK_PREFIX = "agent_console:lock:"
    LOCK_TIMEOUT = 10  # seconds

    def __init__(self, redis_url: str, instance_id: str, lease_timeout: int = 90):
        self._redis = redis.from_url(redis_url, decode_responses=True)
        self._instance_id = instance_id
        self._lease_timeout = lease_timeout
        self._heartbeat_key = f"{self.WORKER_HEARTBEAT_PREFIX}{instance_id}"
        self._info_key = f"{self.WORKER_INFO_PREFIX}{instance_id}"
        self._sweep_task: asyncio.Task[None] | None = None

    async def start(self, extra_info: dict[str, Any] | None = None) -> None:
        """Register this worker and start the heartbeat loop."""
        info = extra_info or {}
        info["instance_id"] = self._instance_id
        info["registered_at"] = utc_now().isoformat()
        info["last_heartbeat_at"] = utc_now().isoformat()

        await _maybe_await(self._redis.hset(self._info_key, mapping=info))
        await _maybe_await(self._redis.expire(self._info_key, self._lease_timeout))

        await self._heartbeat()
        self._sweep_task = asyncio.create_task(self._sweep_stale_loop())

    async def _heartbeat(self) -> None:
        await _maybe_await(
            self._redis.setex(
                self._heartbeat_key,
                self._lease_timeout,
                utc_now().isoformat(),
            )
        )
        await _maybe_await(
            self._redis.hset(
                self._info_key,
                "last_heartbeat_at",
                utc_now().isoformat(),
            )
        )
        await _maybe_await(self._redis.expire(self._info_key, self._lease_timeout))

    async def _sweep_stale_loop(self) -> None:
        """Periodically remove stale heartbeat keys."""
        while True:
            await asyncio.sleep(self._lease_timeout // 3)
            try:
                await self._sweep_stale()
            except Exception:
                logger.exception("Failed to sweep stale workers")

    async def _sweep_stale(self) -> None:
        """Remove heartbeat keys whose TTL has expired."""
        pattern = f"{self.WORKER_HEARTBEAT_PREFIX}*"
        cursor = 0
        while True:
            cursor, keys = await _maybe_await(
                self._redis.scan(cursor, match=pattern, count=100)
            )
            if not keys:
                break
            for key in keys:
                ttl = await _maybe_await(self._redis.ttl(key))
                if ttl == -2:  # key already expired
                    await _maybe_await(self._redis.delete(key))

    async def stop(self) -> None:
        """Unregister this worker."""
        if self._sweep_task:
            self._sweep_task.cancel()
            with __import__("contextlib").suppress(asyncio.CancelledError):
                await self._sweep_task
        await _maybe_await(self._redis.delete(self._heartbeat_key))
        await _maybe_await(self._redis.delete(self._info_key))

    async def list_workers(self) -> list[dict[str, Any]]:
        """Return info for all currently-alive workers."""
        pattern = f"{self.WORKER_HEARTBEAT_PREFIX}*"
        cursor = 0
        worker_ids: list[str] = []
        while True:
            cursor, keys = await _maybe_await(
                self._redis.scan(cursor, match=pattern, count=100)
            )
            if not keys:
                break
            worker_ids.extend(k.split(":")[-1] for k in keys)

        results: list[dict[str, Any]] = []
        for wid in worker_ids:
            info = await _maybe_await(self._redis.hgetall(f"{self.WORKER_INFO_PREFIX}{wid}"))
            if info:
                results.append(info)
        return results

    async def acquire_lock(self, lock_name: str, owner_id: str, ttl: int = 10) -> bool:
        """Try to acquire a distributed lock using SETNX + expiry."""
        key = f"{self.LOCK_PREFIX}{lock_name}"
        acquired = await _maybe_await(self._redis.set(key, owner_id, nx=True, ex=ttl))
        return acquired is True

    async def release_lock(self, lock_name: str, owner_id: str) -> bool:
        """Release a lock only if we are the owner (CAS-style)."""
        key = f"{self.LOCK_PREFIX}{lock_name}"
        lua = """
        if redis.call("get", KEYS[1]) == ARGV[1] then
            return redis.call("del", KEYS[1])
        else
            return 0
        end
        """
        released = await _maybe_await(self._redis.eval(lua, 1, key, owner_id))
        return bool(released)

    async def close(self) -> None:
        await self.stop()
        await _maybe_await(self._redis.aclose())


class NoopWorkerRegistry:
    async def start(self, extra_info: dict[str, Any] | None = None) -> None:
        pass

    async def stop(self) -> None:
        pass

    async def list_workers(self) -> list[dict[str, Any]]:
        return []

    async def acquire_lock(self, lock_name: str, owner_id: str, ttl: int = 10) -> bool:
        return True

    async def release_lock(self, lock_name: str, owner_id: str) -> bool:
        return True

    async def close(self) -> None:
        pass


def build_worker_registry(
    redis_url: str,
    instance_id: str,
    lease_timeout: int = 90,
    enabled: bool = True,
) -> WorkerRegistry:
    if not enabled:
        return NoopWorkerRegistry()  # type: ignore[return-value]
    return WorkerRegistry(redis_url, instance_id, lease_timeout)
