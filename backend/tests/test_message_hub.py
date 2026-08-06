import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.message_hub import MessageHub
from app.db.base import Base
from app.models import Agent, Conversation, Message, Task, TaskStatus, Workspace


class RecordingBroadcaster:
    def __init__(self, log: list[tuple]) -> None:
        self.log = log

    async def broadcast_to_workspace(self, workspace_id: int, event: dict) -> None:
        self.log.append(("broadcast", workspace_id, event["type"]))


@pytest_asyncio.fixture
async def message_hub_session(tmp_path):
    database_path = tmp_path / "message-hub-test.db"
    engine = create_async_engine(f"sqlite+aiosqlite:///{database_path.as_posix()}")
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with session_factory() as session:
        yield session
    await engine.dispose()


async def create_message_hub_graph(session) -> tuple[Workspace, Conversation, Agent]:
    workspace = Workspace(name="Hub workspace", description="tests")
    session.add(workspace)
    await session.flush()
    agent = Agent(
        workspace_id=workspace.id,
        name="项目总设计师",
        role="project_architect",
        model_name="manager_model",
        system_prompt="Plan and dispatch work.",
        status="idle",
    )
    conversation = Conversation(workspace_id=workspace.id, title="Hub chat")
    session.add_all([agent, conversation])
    await session.commit()
    return workspace, conversation, agent


@pytest.mark.asyncio
async def test_receive_user_message_broadcasts_before_dispatch(
    message_hub_session,
) -> None:
    workspace, conversation, agent = await create_message_hub_graph(
        message_hub_session
    )
    log: list[tuple] = []

    def dispatcher(task_id: int) -> None:
        log.append(("dispatch", task_id))

    result = await MessageHub(
        message_hub_session,
        broadcaster=RecordingBroadcaster(log),
        dispatcher=dispatcher,
    ).receive_user_message(conversation.id, "整理这次需求")

    assert result.assigned_agent.id == agent.id
    assert [entry[0] for entry in log] == ["broadcast", "broadcast", "dispatch"]
    assert log[0] == ("broadcast", workspace.id, "message.created")
    assert log[1] == ("broadcast", workspace.id, "task.status_changed")
    assert log[2] == ("dispatch", result.task.id)

    task = await message_hub_session.get(Task, result.task.id)
    message = await message_hub_session.get(Message, result.message.id)
    assert task is not None
    assert task.status == TaskStatus.PENDING
    assert message is not None
    assert message.content == "整理这次需求"
