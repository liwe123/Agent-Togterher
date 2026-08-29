from datetime import timedelta

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base, utc_now
from app.models import Task, TaskQueueItem, TaskStatus, Workspace
from app.services.task_service import TaskService


@pytest_asyncio.fixture
async def queue_session(tmp_path):
    engine = create_async_engine(
        f"sqlite+aiosqlite:///{(tmp_path / 'queue.db').as_posix()}"
    )
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with factory() as session:
        yield session
    await engine.dispose()


async def create_task(session) -> Task:
    workspace = Workspace(name="Queue workspace", description="tests")
    session.add(workspace)
    await session.flush()
    task = Task(
        workspace_id=workspace.id,
        title="Queued task",
        description="Execute through persistent queue",
        status=TaskStatus.PENDING,
    )
    session.add(task)
    await session.commit()
    return task


@pytest.mark.asyncio
async def test_queue_claim_respects_priority_and_completes(queue_session) -> None:
    first = await create_task(queue_session)
    second = Task(
        workspace_id=first.workspace_id,
        title="High priority",
        description="Run first",
        status=TaskStatus.PENDING,
    )
    queue_session.add(second)
    await queue_session.commit()

    service = TaskService(queue_session)
    await service.enqueue(first, priority=1)
    await service.enqueue(second, priority=10)

    claimed = await service.claim_next()
    assert claimed is not None
    assert claimed.task_id == second.id
    assert claimed.attempt_count == 1
    assert claimed.lease_token is not None
    assert await service.complete(claimed.id, claimed.lease_token)

    completed = await queue_session.get(TaskQueueItem, claimed.id)
    assert completed is not None
    assert completed.status == "completed"


@pytest.mark.asyncio
async def test_queue_retries_then_moves_to_dead_letter(queue_session) -> None:
    task = await create_task(queue_session)
    service = TaskService(queue_session)
    await service.enqueue(task, max_attempts=2)

    first = await service.claim_next()
    assert first is not None and first.lease_token is not None
    assert await service.fail(first.id, first.lease_token, "temporary", retry_delay_seconds=0) == "queued"

    second = await service.claim_next()
    assert second is not None and second.lease_token is not None
    assert await service.fail(second.id, second.lease_token, "permanent") == "dead"
    assert await service.claim_next() is None


@pytest.mark.asyncio
async def test_queue_recovers_expired_lease(queue_session) -> None:
    task = await create_task(queue_session)
    service = TaskService(queue_session)
    item = await service.enqueue(task)
    item.status = "leased"
    item.lease_token = "expired"
    item.lease_expires_at = utc_now() - timedelta(seconds=1)
    await queue_session.commit()

    assert await service.recover() == 1
    recovered = await queue_session.get(TaskQueueItem, item.id)
    assert recovered is not None
    assert recovered.status == "queued"
    assert recovered.lease_token is None


# --- C-170: lease renewal -------------------------------------------------


@pytest.mark.asyncio
async def test_renew_extends_lease_and_blocks_recovery(queue_session) -> None:
    """A renewed in-flight item must survive a recovery sweep."""
    task = await create_task(queue_session)
    service = TaskService(queue_session)
    await service.enqueue(task)
    claimed = await service.claim_next()
    assert claimed is not None and claimed.lease_token is not None

    # Force the lease to the brink of expiry, as a long-running task would.
    claimed.lease_expires_at = utc_now() + timedelta(seconds=1)
    await queue_session.commit()

    assert await service.renew(claimed.id, claimed.lease_token, lease_seconds=600)
    assert await service.recover() == 0

    renewed = await queue_session.get(TaskQueueItem, claimed.id)
    assert renewed is not None
    assert renewed.status == "leased"
    assert renewed.lease_expires_at > utc_now() + timedelta(seconds=500)
    # A renewed lease is still finishable by its owner.
    assert await service.complete(claimed.id, claimed.lease_token)


@pytest.mark.asyncio
async def test_renew_rejects_stale_or_finished_items(queue_session) -> None:
    task = await create_task(queue_session)
    service = TaskService(queue_session)
    await service.enqueue(task)
    claimed = await service.claim_next()
    assert claimed is not None and claimed.lease_token is not None

    # Wrong token: another worker owns the item.
    assert not await service.renew(claimed.id, "not-my-token", lease_seconds=600)

    # Already completed: nothing left to renew.
    assert await service.complete(claimed.id, claimed.lease_token)
    assert not await service.renew(claimed.id, claimed.lease_token, lease_seconds=600)


@pytest.mark.asyncio
async def test_unrenewed_lease_is_reclaimed_by_recovery(queue_session) -> None:
    """Control case: without renewal the expired item goes back to the queue."""
    task = await create_task(queue_session)
    service = TaskService(queue_session)
    await service.enqueue(task)
    claimed = await service.claim_next()
    assert claimed is not None

    claimed.lease_expires_at = utc_now() - timedelta(seconds=1)
    await queue_session.commit()

    assert await service.recover() == 1
    requeued = await queue_session.get(TaskQueueItem, claimed.id)
    assert requeued is not None
    assert requeued.status == "queued"
    assert requeued.lease_token is None


# --- 2026-08-29 container run: zombie queue item on finalized tasks -------


@pytest.mark.asyncio
async def test_default_retry_after_task_finalized_would_zombie(queue_session) -> None:
    """Root-cause documentation: re-queuing a finalized task strands the item.

    ``claim_next`` only matches PENDING tasks, so an item re-queued after the
    orchestrator already failed its task can never be claimed again — nor does
    it reach a terminal queue state. This is why the worker must settle
    orchestrator-finalized failures with ``retry=False`` (next test).
    """
    task = await create_task(queue_session)
    service = TaskService(queue_session)
    await service.enqueue(task, max_attempts=3)
    claimed = await service.claim_next()
    assert claimed is not None and claimed.lease_token is not None

    task.status = TaskStatus.FAILED
    await queue_session.commit()

    assert await service.fail(
        claimed.id, claimed.lease_token, "boom", retry_delay_seconds=0
    ) == "queued"
    assert await service.claim_next() is None  # zombie: unclaimable, not dead
    item = await queue_session.get(TaskQueueItem, claimed.id)
    assert item is not None and item.status == "queued"


@pytest.mark.asyncio
async def test_fail_without_retry_settles_finalized_task_as_dead(
    queue_session,
) -> None:
    """The worker fix: finalized tasks settle the item as dead, not queued."""
    task = await create_task(queue_session)
    service = TaskService(queue_session)
    await service.enqueue(task, max_attempts=3)
    claimed = await service.claim_next()
    assert claimed is not None and claimed.lease_token is not None

    task.status = TaskStatus.FAILED
    await queue_session.commit()

    assert await service.fail(
        claimed.id, claimed.lease_token, "boom", retry=False
    ) == "dead"
    assert await service.claim_next() is None
    item = await queue_session.get(TaskQueueItem, claimed.id)
    assert item is not None and item.status == "dead"
    assert item.lease_token is None and item.last_error == "boom"
