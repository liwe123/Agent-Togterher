from __future__ import annotations

import asyncio
import contextlib
import logging
from time import monotonic

from app.core.config import get_settings
from app.core.orchestrator import run_task
from app.db.session import AsyncSessionLocal, close_db, init_db
from app.services.task_service import TaskService
from app.websocket import build_event_relay, websocket_manager

logger = logging.getLogger(__name__)


async def _renew_lease(
    item_id: int,
    lease_token: str,
    *,
    interval_seconds: float,
    lease_seconds: int,
) -> None:
    """Keep a claimed queue item's lease alive until it finishes or is lost.

    C-171: without this, any task running longer than its lease is re-queued
    mid-flight and executed a second time.
    """
    while True:
        await asyncio.sleep(interval_seconds)
        try:
            async with AsyncSessionLocal() as session:
                renewed = await TaskService(session).renew(
                    item_id, lease_token, lease_seconds=lease_seconds
                )
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception(
                "Lease renewal failed, stopping renewer",
                extra={"queue_item_id": item_id},
            )
            return
        if not renewed:
            # Lease was lost: someone else owns this item now, stop touching it.
            logger.warning(
                "Task queue lease lost during execution",
                extra={"queue_item_id": item_id},
            )
            return


async def _consume_once() -> bool:
    settings = get_settings()
    async with AsyncSessionLocal() as session:
        item = await TaskService(session).claim_next()
        if item is None or item.lease_token is None:
            return False
        item_id = item.id
        task_id = item.task_id
        lease_token = item.lease_token
        lease_seconds = max(60, int(item.timeout_seconds or 1800))

    renewer = asyncio.create_task(
        _renew_lease(
            item_id,
            lease_token,
            interval_seconds=settings.worker_lease_renew_interval_seconds,
            lease_seconds=lease_seconds,
        )
    )
    try:
        result = await run_task(task_id)
        if result.status.value == "completed":
            async with AsyncSessionLocal() as session:
                await TaskService(session).complete(item_id, lease_token)
        else:
            async with AsyncSessionLocal() as session:
                await TaskService(session).fail(
                    item_id, lease_token, result.result or "Task execution failed"
                )
    except Exception as exc:
        logger.exception("Worker task execution failed", extra={"task_id": task_id})
        async with AsyncSessionLocal() as session:
            await TaskService(session).fail(item_id, lease_token, str(exc))
    finally:
        renewer.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await renewer
    return True


async def _sweep_expired_leases() -> int:
    """Re-queue items whose worker died, so they can be picked up again."""
    try:
        async with AsyncSessionLocal() as session:
            return await TaskService(session).recover()
    except Exception:
        logger.exception("Lease recovery sweep failed")
        return 0


async def run_worker() -> None:
    settings = get_settings()
    await init_db()
    async with AsyncSessionLocal() as session:
        await TaskService(session).recover()

    # C-170：任务在 Worker 进程内执行，orchestrator 广播到的是本进程的
    # websocket_manager。该进程没有任何 WS 客户端连接，若不注册分布式
    # publisher，任务事件会全部静默丢弃，前端实时推送整体失效。
    # build_event_relay 在 event_bus_enabled=False 时返回 Noop，零 Redis 依赖。
    event_relay = build_event_relay(
        websocket_manager, settings.worker_instance_id, settings.event_bus_enabled
    )
    await event_relay.start()
    logger.info(
        "Worker event relay started",
        extra={
            "instance_id": settings.worker_instance_id,
            "event_bus_enabled": settings.event_bus_enabled,
        },
    )

    semaphore = asyncio.Semaphore(settings.worker_concurrency)
    active: set[asyncio.Task[None]] = set()
    last_recover_at = monotonic()

    async def consume() -> None:
        async with semaphore:
            await _consume_once()

    try:
        while True:
            active = {task for task in active if not task.done()}
            while len(active) < settings.worker_concurrency:
                task = asyncio.create_task(consume())
                active.add(task)
                await asyncio.sleep(0)
            if active:
                await asyncio.wait(active, return_when=asyncio.FIRST_COMPLETED)
            await asyncio.sleep(settings.worker_poll_interval_seconds)

            # C-171: recovery used to run once at startup only, so a crashed
            # worker's tasks stayed leased forever until the next restart.
            now = monotonic()
            if now - last_recover_at >= settings.worker_recover_interval_seconds:
                last_recover_at = now
                recovered = await _sweep_expired_leases()
                if recovered:
                    logger.info("Recovered expired task leases", extra={"count": recovered})
    finally:
        if active:
            await asyncio.gather(*active, return_exceptions=True)
        await event_relay.stop()
        await close_db()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(run_worker())
