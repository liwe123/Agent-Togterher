from __future__ import annotations

import asyncio
import logging

from app.core.config import get_settings
from app.core.orchestrator import run_task
from app.db.session import AsyncSessionLocal, close_db, init_db
from app.services.task_service import TaskService

logger = logging.getLogger(__name__)


async def _consume_once() -> bool:
    async with AsyncSessionLocal() as session:
        item = await TaskService(session).claim_next()
        if item is None or item.lease_token is None:
            return False
        item_id = item.id
        task_id = item.task_id
        lease_token = item.lease_token

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
    return True


async def run_worker() -> None:
    settings = get_settings()
    await init_db()
    async with AsyncSessionLocal() as session:
        await TaskService(session).recover()

    semaphore = asyncio.Semaphore(settings.worker_concurrency)
    active: set[asyncio.Task[None]] = set()

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
    finally:
        if active:
            await asyncio.gather(*active, return_exceptions=True)
        await close_db()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(run_worker())
