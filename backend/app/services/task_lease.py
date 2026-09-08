"""Task-level execution lease helpers (A4 租约统一, Step 1).

统一"任务执行权"的 task 级租约（``Task.execution_token`` /
``Task.execution_token_expires_at``）。该租约与队列级租约
（``task_queue_items.lease_token``，见 ``app.services.task_service``）是两套
独立机制：

- 队列租约由独立 Worker 消费 ``task_queue_items`` 时持有（C-170/C-171）；
- 任务租约由 inline / DAG / orchestrator 路径在把任务置为 RUNNING 时写入
  ``Task`` 行，保证同一任务不会同时被两个执行体认领。

本模块收敛任务租约的 claim / renew / 过期判定三件事，所有写
``execution_token`` 的入口都应经由这里的函数（20260907 报告 OPT-1/A4）。
异常类型与常量从 ``app.core.orchestrator`` 迁来，orchestrator 侧 re-export，
保持对外 import 兼容。
"""

from __future__ import annotations

import asyncio
import logging
from datetime import timedelta
from typing import Final
from uuid import uuid4

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.base import utc_now
from app.db.session import AsyncSessionLocal
from app.models import Task, TaskStatus
from app.schemas import TaskRead
from app.websocket.events import create_event

logger = logging.getLogger(__name__)

TASK_LEASE_DURATION: Final = timedelta(minutes=30)
TASK_LEASE_RENEW_INTERVAL_SECONDS: Final = 300


class OrchestratorError(Exception):
    """Base error for requests that cannot be handed to the orchestrator."""


class TaskNotFoundError(OrchestratorError):
    """Raised when a task id does not exist."""


class TaskNotRunnableError(OrchestratorError):
    """Raised when a task cannot enter the running state."""


async def claim_task_lease(
    session: AsyncSession,
    task_id: int,
    *,
    broadcaster=None,
) -> Task:
    """把 PENDING 任务认领为 RUNNING（CAS 写 execution_token 租约）。

    与 worker 队列路径（TaskService.claim_next）互不冲突：本函数只处理
    ``Task`` 行的任务级租约；执行入口（inline orchestrator / DAG 引擎 /
    queue worker 的 run_task）在真正执行前调用它，确保独占执行权。

    递归语义：若任务已是 RUNNING 但租约已过期（此前执行体崩溃/丢失租约），
    重置为 PENDING 后重新认领。失败原因：任务不存在 / 任务不处于可运行态。
    """
    claim_token = str(uuid4())
    lease_expires_at = utc_now() + TASK_LEASE_DURATION
    claim = await session.execute(
        update(Task)
        .where(Task.id == task_id, Task.status == TaskStatus.PENDING)
        .values(
            status=TaskStatus.RUNNING,
            execution_token=claim_token,
            execution_token_expires_at=lease_expires_at,
            updated_at=utc_now(),
        )
    )
    if claim.rowcount != 1:
        await session.rollback()
        task = await session.get(Task, task_id)
        if task is None:
            raise TaskNotFoundError(f"Task {task_id} not found")
        if (
            task.status == TaskStatus.RUNNING
            and task.execution_token_expires_at is not None
            and task.execution_token_expires_at < utc_now()
        ):
            task.status = TaskStatus.PENDING
            task.execution_token = None
            task.execution_token_expires_at = None
            await session.commit()
            task = await session.get(Task, task_id)
            if task is None:
                raise TaskNotFoundError(
                    f"Task {task_id} not found after claim reset"
                )
            return await claim_task_lease(session, task_id, broadcaster=broadcaster)
        raise TaskNotRunnableError(
            f"Task {task_id} is {task.status.value} and cannot be started"
        )

    await session.commit()
    task = await session.get(Task, task_id)
    if task is None:
        raise TaskNotFoundError(f"Task {task_id} not found after claim")

    if broadcaster is not None:
        task_data = TaskRead.model_validate(task)
        await broadcaster.broadcast_to_workspace(
            task.workspace_id,
            create_event("task.status_changed", task_data),
        )
    return task


def task_lease_is_expired(task: Task, *, now=None) -> bool:
    """任务级租约是否已过期（供 worker 定时回收 / orchestrator 抢回判定）。"""
    if task.status != TaskStatus.RUNNING or task.execution_token_expires_at is None:
        return False
    return task.execution_token_expires_at < (now if now is not None else utc_now())


async def renew_task_lease(
    task_id: int,
    token: str | None,
    *,
    on_lost=None,
) -> None:
    """周期性续期任务级租约，直到任务结束或租约丢失（orchestrator 后台协程）。

    默认使用进程级 ``AsyncSessionLocal``（与 orchestrator 原实现一致），
    便于 DAG / queue worker 等执行体直接复用。``on_lost`` 为可选的丢失
    回调（Step 4：续租失败时置 cancel_event 协作取消执行）。
    """
    if token is None:
        return
    while True:
        await asyncio.sleep(TASK_LEASE_RENEW_INTERVAL_SECONDS)
        renewed = False
        try:
            async with AsyncSessionLocal() as session:
                renewed = await _extend_task_lease(session, task_id, token)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception(
                "Task lease renewal failed, stopping renewer",
                extra={"task_id": task_id},
            )
            return
        if not renewed:
            logger.warning(
                "Task lease was lost",
                extra={"task_id": task_id},
            )
            if on_lost is not None:
                on_lost(task_id)
            return


async def _extend_task_lease(
    session: AsyncSession, task_id: int, token: str
) -> bool:
    """续期任务级租约：执行中状态（RUNNING / WAITING_APPROVAL）+ token 匹配。

    审批挂起（HITL）期间任务状态为 WAITING_APPROVAL 但执行体仍在等待，
    此时租约必须继续续期，否则会被 worker 过期扫描误判为僵尸任务。
    """
    renewed = await session.execute(
        update(Task)
        .where(
            Task.id == task_id,
            Task.status.in_([TaskStatus.RUNNING, TaskStatus.WAITING_APPROVAL]),
            Task.execution_token == token,
        )
        .values(
            execution_token_expires_at=utc_now() + TASK_LEASE_DURATION,
            updated_at=utc_now(),
        )
    )
    await session.commit()
    return renewed.rowcount == 1


def release_task_lease(task: Task) -> None:
    """终态清理任务级租约（COMPLETED / FAILED 时调用）。"""
    task.execution_token = None
    task.execution_token_expires_at = None


async def recover_expired_task_leases(session: AsyncSession) -> int:
    """把任务级租约已过期的僵尸任务置为 FAILED（A4 Step 3）。

    执行体崩溃 / 租约丢失且无人续租时，任务可能长期停留在 RUNNING /
    WAITING_APPROVAL。worker 定时扫描本函数（配合队列级
    ``TaskService.recover``），把这类任务收敛为 FAILED，避免半途任务被
    无主重跑产生重复副作用（20260907 报告 OPT-1 Step 3 决策：置 FAILED
    而非重置 PENDING）。

    正常执行中且租约有效（expires_at 在未来）的任务不会被触碰。
    """
    now = utc_now()
    expired = list(
        await session.scalars(
            select(Task).where(
                Task.status.in_([TaskStatus.RUNNING, TaskStatus.WAITING_APPROVAL]),
                Task.execution_token_expires_at.is_not(None),
                Task.execution_token_expires_at < now,
            )
        )
    )
    for task in expired:
        task.status = TaskStatus.FAILED
        task.result = (task.result or "") + " [租约过期，任务被 worker 回收]"
        task.execution_token = None
        task.execution_token_expires_at = None
        task.updated_at = utc_now()
    await session.commit()
    return len(expired)
