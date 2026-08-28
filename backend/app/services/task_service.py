from __future__ import annotations

from datetime import timedelta
from uuid import uuid4

from sqlalchemy import or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.base import utc_now
from app.models import Task, TaskQueueItem, TaskStatus

QUEUE_TERMINAL_STATUSES = {"completed", "dead"}


class TaskService:
    """Persistent task queue commands shared by API producers and workers."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def enqueue(
        self,
        task: Task,
        *,
        priority: int = 0,
        max_attempts: int = 3,
        timeout_seconds: int = 1800,
    ) -> TaskQueueItem:
        item = await self._session.scalar(
            select(TaskQueueItem).where(TaskQueueItem.task_id == task.id)
        )
        if item is None:
            item = TaskQueueItem(
                task_id=task.id,
                priority=priority,
                max_attempts=max_attempts,
                timeout_seconds=timeout_seconds,
            )
            self._session.add(item)
        elif item.status not in QUEUE_TERMINAL_STATUSES:
            item.status = "queued"
            item.available_at = utc_now()
            item.lease_token = None
            item.lease_expires_at = None
        await self._session.commit()
        await self._session.refresh(item)
        return item

    async def claim_next(self, *, lease_seconds: int = 60) -> TaskQueueItem | None:
        now = utc_now()
        candidates = list(
            await self._session.scalars(
                select(TaskQueueItem)
                .join(Task, Task.id == TaskQueueItem.task_id)
                .where(
                    Task.status == TaskStatus.PENDING,
                    TaskQueueItem.attempt_count < TaskQueueItem.max_attempts,
                    TaskQueueItem.available_at <= now,
                    or_(
                        TaskQueueItem.status == "queued",
                        TaskQueueItem.lease_expires_at < now,
                    ),
                )
                .order_by(TaskQueueItem.priority.desc(), TaskQueueItem.id.asc())
                .limit(10)
            )
        )
        for candidate in candidates:
            token = str(uuid4())
            claimed = await self._session.execute(
                update(TaskQueueItem)
                .where(
                    TaskQueueItem.id == candidate.id,
                    TaskQueueItem.attempt_count < TaskQueueItem.max_attempts,
                    or_(
                        TaskQueueItem.status == "queued",
                        TaskQueueItem.lease_expires_at < now,
                    ),
                )
                .values(
                    status="leased",
                    attempt_count=TaskQueueItem.attempt_count + 1,
                    lease_token=token,
                    lease_expires_at=now
                    + timedelta(seconds=max(lease_seconds, candidate.timeout_seconds)),
                    updated_at=now,
                )
            )
            if claimed.rowcount == 1:
                await self._session.commit()
                return await self._session.get(TaskQueueItem, candidate.id)
            await self._session.rollback()
        return None

    async def renew(self, item_id: int, lease_token: str, *, lease_seconds: int) -> bool:
        """Extend the lease of an in-flight queue item (C-171).

        Workers call this periodically while a task is still running so that
        long-running executions are not mistaken for a crashed worker and
        re-queued by :meth:`recover`.

        Returns ``False`` when the lease was lost — the item was already
        finished, re-queued, or stolen by another worker — which tells the
        caller it must stop touching the task.
        """
        now = utc_now()
        renewed = await self._session.execute(
            update(TaskQueueItem)
            .where(
                TaskQueueItem.id == item_id,
                TaskQueueItem.status == "leased",
                TaskQueueItem.lease_token == lease_token,
            )
            .values(
                lease_expires_at=now + timedelta(seconds=lease_seconds),
                updated_at=now,
            )
        )
        await self._session.commit()
        return renewed.rowcount == 1

    async def complete(self, item_id: int, lease_token: str) -> bool:
        return await self._finish(item_id, lease_token, status="completed")

    async def fail(
        self,
        item_id: int,
        lease_token: str,
        error: str,
        *,
        retry_delay_seconds: int = 5,
    ) -> str | None:
        item = await self._session.get(TaskQueueItem, item_id)
        if item is None or item.status != "leased" or item.lease_token != lease_token:
            return None
        item.last_error = error[:4000]
        item.lease_token = None
        item.lease_expires_at = None
        if item.attempt_count >= item.max_attempts:
            item.status = "dead"
        else:
            item.status = "queued"
            item.available_at = utc_now() + timedelta(seconds=retry_delay_seconds)
        await self._session.commit()
        return item.status

    async def recover(self) -> int:
        now = utc_now()
        recovered = await self._session.execute(
            update(TaskQueueItem)
            .where(
                TaskQueueItem.status == "leased",
                TaskQueueItem.lease_expires_at < now,
                TaskQueueItem.attempt_count < TaskQueueItem.max_attempts,
            )
            .values(
                status="queued",
                lease_token=None,
                lease_expires_at=None,
                available_at=now,
                updated_at=now,
            )
        )
        await self._session.commit()
        return int(recovered.rowcount or 0)

    async def _finish(self, item_id: int, lease_token: str, *, status: str) -> bool:
        finished = await self._session.execute(
            update(TaskQueueItem)
            .where(
                TaskQueueItem.id == item_id,
                TaskQueueItem.status == "leased",
                TaskQueueItem.lease_token == lease_token,
            )
            .values(
                status=status,
                lease_token=None,
                lease_expires_at=None,
                updated_at=utc_now(),
            )
        )
        await self._session.commit()
        return finished.rowcount == 1
