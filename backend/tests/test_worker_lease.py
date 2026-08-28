"""C-170: Worker 必须在任务执行期间续租，并定期回收失联任务的租约。

没有续租时，任何跑得比租约更久的任务都会在半途被 recover() 判定为失联、
重新入队，从而被执行第二次。这里的用例锁住该行为。
"""

from __future__ import annotations

import asyncio
from datetime import timedelta
from types import SimpleNamespace

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app import worker as worker_module
from app.db.base import Base, utc_now
from app.models import Task, TaskQueueItem, TaskStatus, Workspace
from app.services.task_service import TaskService


class _FakeSettings:
    """续租间隔压到毫秒级，避免测试真的等上几十秒。"""

    worker_lease_renew_interval_seconds = 0.05
    worker_recover_interval_seconds = 3600
    worker_poll_interval_seconds = 0.01
    worker_concurrency = 2


@pytest_asyncio.fixture
async def queue_factory(tmp_path):
    engine = create_async_engine(
        f"sqlite+aiosqlite:///{(tmp_path / 'worker_lease.db').as_posix()}"
    )
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    yield factory
    await engine.dispose()


async def _read_item(factory, task_id: int) -> TaskQueueItem:
    async with factory() as session:
        return (
            await session.execute(
                select(TaskQueueItem).where(TaskQueueItem.task_id == task_id)
            )
        ).scalar_one()


async def _seed_task(factory) -> int:
    async with factory() as session:
        workspace = Workspace(name="Lease workspace", description="tests")
        session.add(workspace)
        await session.flush()
        task = Task(
            workspace_id=workspace.id,
            title="Slow task",
            description="Runs longer than one lease",
            status=TaskStatus.PENDING,
        )
        session.add(task)
        await session.commit()
        task_id = task.id
    async with factory() as session:
        await TaskService(session).enqueue(task, timeout_seconds=5)
    return task_id


def _completed_result() -> SimpleNamespace:
    return SimpleNamespace(status=SimpleNamespace(value="completed"), result="ok")


@pytest.mark.asyncio
async def test_worker_renews_lease_while_task_runs(queue_factory, monkeypatch) -> None:
    """任务执行期间租约必须被持续延长，而不是停在 claim 那一刻。"""
    task_id = await _seed_task(queue_factory)
    observed: dict[str, object] = {}

    async def fake_run_task(tid: int) -> SimpleNamespace:
        item = await _read_item(queue_factory, tid)
        observed["start_lease"] = item.lease_expires_at
        # 远长于续租间隔，确保续租协程至少跑过一轮
        await asyncio.sleep(0.6)
        item = await _read_item(queue_factory, tid)
        observed["end_lease"] = item.lease_expires_at
        return _completed_result()

    monkeypatch.setattr(worker_module, "get_settings", lambda: _FakeSettings)
    monkeypatch.setattr(worker_module, "AsyncSessionLocal", queue_factory)
    monkeypatch.setattr(worker_module, "run_task", fake_run_task)

    await worker_module._consume_once()

    assert observed["end_lease"] > observed["start_lease"], (
        "租约应在任务执行期间被续期延长，否则长任务会被误判失联而重复执行"
    )
    item = await _read_item(queue_factory, task_id)
    assert item.status == "completed"


@pytest.mark.asyncio
async def test_renewer_stops_when_lease_is_lost(queue_factory, monkeypatch) -> None:
    """租约被别人抢走后续租协程应自行退出，不再碰这条队列项。"""
    task_id = await _seed_task(queue_factory)
    renew_calls = 0
    original_renew = TaskService.renew

    async def counting_renew(self, item_id, lease_token, *, lease_seconds):
        nonlocal renew_calls
        renew_calls += 1
        # 模拟租约在执行途中失效
        result = await original_renew(self, item_id, "stolen-token", lease_seconds=lease_seconds)
        return result

    async def fake_run_task(tid: int) -> SimpleNamespace:
        await asyncio.sleep(0.3)
        return _completed_result()

    monkeypatch.setattr(worker_module, "get_settings", lambda: _FakeSettings)
    monkeypatch.setattr(worker_module, "AsyncSessionLocal", queue_factory)
    monkeypatch.setattr(worker_module, "run_task", fake_run_task)
    monkeypatch.setattr(TaskService, "renew", counting_renew)

    await worker_module._consume_once()

    # 续租协程在首次续租失败后即退出，不应反复重试
    assert renew_calls == 1
    item = await _read_item(queue_factory, task_id)
    assert item.status == "completed"


@pytest.mark.asyncio
async def test_sweep_expired_leases_requeues_orphans(queue_factory, monkeypatch) -> None:
    """Worker 崩溃留下的过期租约应被回收，重新可被消费。"""
    task_id = await _seed_task(queue_factory)

    async with queue_factory() as session:
        claimed = await TaskService(session).claim_next()
        assert claimed is not None
    async with queue_factory() as session:
        async with session.begin():
            item = await session.get(TaskQueueItem, claimed.id)
            item.lease_expires_at = utc_now() - timedelta(seconds=1)

    monkeypatch.setattr(worker_module, "AsyncSessionLocal", queue_factory)
    recovered = await worker_module._sweep_expired_leases()

    assert recovered == 1
    item = await _read_item(queue_factory, task_id)
    assert item.status == "queued"
    assert item.lease_token is None
