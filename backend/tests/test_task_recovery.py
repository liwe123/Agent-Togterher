import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base
from app.models import Agent, Conversation, Task, TaskStatus, Workspace


@pytest_asyncio.fixture
async def recovery_session(tmp_path):
    database_path = tmp_path / "task-recovery-test.db"
    engine = create_async_engine(f"sqlite+aiosqlite:///{database_path.as_posix()}")
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with session_factory() as session:
        yield session
    await engine.dispose()


async def create_recovery_graph(session) -> tuple[Task, Task, Task]:
    workspace = Workspace(name="Recovery workspace", description="tests")
    session.add(workspace)
    await session.flush()
    agent = Agent(
        workspace_id=workspace.id,
        name="Recovery agent",
        role="worker",
        model_name="code_model",
        system_prompt="Recover tasks.",
        status="running",
    )
    conversation = Conversation(workspace_id=workspace.id, title="Recovery chat")
    session.add_all([agent, conversation])
    await session.flush()
    pending_task = Task(
        workspace_id=workspace.id,
        conversation_id=conversation.id,
        title="Pending task",
        description="Dispatch this pending task.",
        assigned_agent_id=agent.id,
        status=TaskStatus.PENDING,
    )
    running_task = Task(
        workspace_id=workspace.id,
        conversation_id=conversation.id,
        title="Interrupted task",
        description="Recover this interrupted task.",
        assigned_agent_id=agent.id,
        status=TaskStatus.RUNNING,
    )
    completed_task = Task(
        workspace_id=workspace.id,
        conversation_id=conversation.id,
        title="Completed task",
        description="Do not dispatch this task.",
        assigned_agent_id=agent.id,
        status=TaskStatus.COMPLETED,
    )
    session.add_all([pending_task, running_task, completed_task])
    await session.commit()
    return pending_task, running_task, completed_task


@pytest.mark.asyncio
async def test_recover_unfinished_tasks_dispatches_pending_and_running_tasks(
    recovery_session,
) -> None:
    pending_task, running_task, completed_task = await create_recovery_graph(
        recovery_session
    )
    dispatched: list[int] = []

    from app.core.message_hub import recover_unfinished_tasks

    recovered_count = await recover_unfinished_tasks(
        recovery_session,
        dispatcher=dispatched.append,
    )

    assert recovered_count == 2
    assert dispatched == [pending_task.id, running_task.id]

    running_after_recovery = await recovery_session.scalar(
        select(Task).where(Task.id == running_task.id)
    )
    completed_after_recovery = await recovery_session.scalar(
        select(Task).where(Task.id == completed_task.id)
    )
    assert running_after_recovery is not None
    assert running_after_recovery.status == TaskStatus.PENDING
    assert completed_after_recovery is not None
    assert completed_after_recovery.status == TaskStatus.COMPLETED
