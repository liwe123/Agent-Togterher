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
from app.models.workflow import WorkflowRun, WorkflowTemplate
from app.services.task_lease import recover_orphan_workflow_runs
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


# ---------------------------------------------------------------------------
# A4 Step 3：worker 定时扫描把任务级过期租约置 FAILED
# ---------------------------------------------------------------------------


async def _seed_expired_running_task(
    factory, *, status=TaskStatus.RUNNING, expires_seconds_ago: int = 10
) -> int:
    """造一个执行中但租约已过期的任务（模拟执行体崩溃、无续租）。"""
    async with factory() as session:
        workspace = Workspace(name="Expired lease ws", description="tests")
        session.add(workspace)
        await session.flush()
        task = Task(
            workspace_id=workspace.id,
            title="Zombie task",
            description="Executor crashed mid-flight",
            status=status,
            execution_token="dead-beef-token",
            execution_token_expires_at=utc_now()
            - timedelta(seconds=expires_seconds_ago),
        )
        session.add(task)
        await session.commit()
        return task.id


@pytest.mark.asyncio
async def test_sweep_fails_task_with_expired_task_lease(
    queue_factory, monkeypatch
) -> None:
    """任务级租约过期（RUNNING）应被 worker sweep 收敛为 FAILED。"""
    monkeypatch.setattr(worker_module, "AsyncSessionLocal", queue_factory)
    task_id = await _seed_expired_running_task(queue_factory)

    recovered = await worker_module._sweep_expired_leases()

    assert recovered >= 1
    async with queue_factory() as session:
        task = await session.get(Task, task_id)
    assert task is not None
    assert task.status == TaskStatus.FAILED
    assert task.execution_token is None
    assert task.execution_token_expires_at is None
    assert "租约过期" in (task.result or "")


@pytest.mark.asyncio
async def test_sweep_does_not_touch_valid_running_task(
    queue_factory, monkeypatch
) -> None:
    """租约有效（未过期）的 RUNNING 任务不得被 sweep 误伤。"""
    monkeypatch.setattr(worker_module, "AsyncSessionLocal", queue_factory)
    async with queue_factory() as session:
        workspace = Workspace(name="Healthy ws", description="tests")
        session.add(workspace)
        await session.flush()
        task = Task(
            workspace_id=workspace.id,
            title="Healthy task",
            description="Still executing with valid lease",
            status=TaskStatus.RUNNING,
            execution_token="still-valid-token",
            execution_token_expires_at=utc_now() + timedelta(minutes=10),
        )
        session.add(task)
        await session.commit()
        task_id = task.id

    recovered = await worker_module._sweep_expired_leases()

    assert recovered == 0
    async with queue_factory() as session:
        task = await session.get(Task, task_id)
    assert task is not None and task.status == TaskStatus.RUNNING
    assert task.execution_token == "still-valid-token"


# ---------------------------------------------------------------------------
# P0-5：DAG 孤儿 WorkflowRun 收敛（崩溃后不再永久 running）
# ---------------------------------------------------------------------------


async def _seed_workflow_run(factory, task_id: int, status: str = "running") -> int:
    async with factory() as session:
        template = WorkflowTemplate(
            name=f"tpl-{task_id}",
            display_name="Tpl",
            nodes_json="[]",
        )
        session.add(template)
        await session.flush()
        run = WorkflowRun(template_id=template.id, task_id=task_id, status=status)
        session.add(run)
        await session.commit()
        return run.id


async def _seed_task_with_status(factory, status: TaskStatus) -> int:
    async with factory() as session:
        workspace = Workspace(name=f"orphan-{status.value}", description="tests")
        session.add(workspace)
        await session.flush()
        task = Task(
            workspace_id=workspace.id,
            title="Workflow host task",
            description="DAG host",
            status=status,
        )
        session.add(task)
        await session.commit()
        return task.id


@pytest.mark.asyncio
async def test_sweep_converges_workflow_run_of_expired_task(
    queue_factory, monkeypatch
) -> None:
    """任务级租约过期被回收时，关联的 running WorkflowRun 一并收敛。"""
    monkeypatch.setattr(worker_module, "AsyncSessionLocal", queue_factory)
    task_id = await _seed_expired_running_task(queue_factory)
    run_id = await _seed_workflow_run(queue_factory, task_id)

    await worker_module._sweep_expired_leases()

    async with queue_factory() as session:
        task = await session.get(Task, task_id)
        run = await session.get(WorkflowRun, run_id)
    assert task is not None and task.status == TaskStatus.FAILED
    assert run is not None and run.status == "failed"


@pytest.mark.asyncio
async def test_recover_orphan_workflow_runs_maps_terminal_status(
    queue_factory,
) -> None:
    """父任务终态映射：completed→completed，failed/cancelled→failed。"""
    completed_task_id = await _seed_task_with_status(
        queue_factory, TaskStatus.COMPLETED
    )
    failed_task_id = await _seed_task_with_status(queue_factory, TaskStatus.FAILED)
    pending_task_id = await _seed_task_with_status(queue_factory, TaskStatus.PENDING)

    completed_run_id = await _seed_workflow_run(queue_factory, completed_task_id)
    failed_run_id = await _seed_workflow_run(queue_factory, failed_task_id)
    pending_run_id = await _seed_workflow_run(queue_factory, pending_task_id)

    async with queue_factory() as session:
        recovered = await recover_orphan_workflow_runs(session)
        completed_run = await session.get(WorkflowRun, completed_run_id)
        failed_run = await session.get(WorkflowRun, failed_run_id)
        pending_run = await session.get(WorkflowRun, pending_run_id)

    assert recovered == 2
    assert completed_run is not None and completed_run.status == "completed"
    assert failed_run is not None and failed_run.status == "failed"
    # 任务仍 PENDING（尚未执行）时不得误伤运行记录。
    assert pending_run is not None and pending_run.status == "running"
