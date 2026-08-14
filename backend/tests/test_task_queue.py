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
