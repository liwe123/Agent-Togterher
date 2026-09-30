import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.errors import AppError
from app.core.message_hub import MessageHub
from app.db.base import Base
from app.models import (
    Agent,
    Conversation,
    IntegrationNode,
    Message,
    Task,
    TaskStatus,
    Workspace,
)


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


@pytest.mark.asyncio
async def test_receive_user_message_routes_to_agent_by_role_model_and_alias(
    message_hub_session,
) -> None:
    workspace, conversation, manager = await create_message_hub_graph(
        message_hub_session
    )
    qa_agent = Agent(
        workspace_id=workspace.id,
        name="测试专员",
        role="qa_engineer",
        model_name="review_model",
        system_prompt="QA checks",
        status="idle",
    )
    fe_agent = Agent(
        workspace_id=workspace.id,
        name="前端设计师",
        role="frontend_designer",
        model_name="code_model",
        system_prompt="Frontend styling",
        status="idle",
    )
    be_agent = Agent(
        workspace_id=workspace.id,
        name="Agent工程师",
        role="agent_engineer",
        model_name="backend_model",
        system_prompt="Backend engineering",
        status="idle",
    )
    node = IntegrationNode(
        workspace_id=workspace.id,
        name="Cursor",
        provider="cursor",
        mode="bridge",
        status="online",
        current_task_count=0,
        max_concurrency=1,
    )
    message_hub_session.add_all([qa_agent, fe_agent, be_agent, node])
    await message_hub_session.commit()

    hub = MessageHub(message_hub_session, dispatcher=lambda tid: None)

    async def complete_task(task_id: int) -> None:
        t = await message_hub_session.get(Task, task_id)
        if t is not None:
            t.status = TaskStatus.COMPLETED
            await message_hub_session.commit()

    # 1. Mention by agent name
    r1 = await hub.receive_user_message(conversation.id, "@测试专员 执行回归测试")
    assert r1.assigned_agent.id == qa_agent.id
    assert r1.task.assigned_agent_id == qa_agent.id
    assert r1.assigned_agent.model_name == "review_model"
    await complete_task(r1.task.id)

    # 2. Mention by role
    r2 = await hub.receive_user_message(conversation.id, "@qa_engineer run review")
    assert r2.assigned_agent.id == qa_agent.id
    assert r2.task.assigned_agent_id == qa_agent.id
    await complete_task(r2.task.id)

    # 3. Mention by model_name
    r3 = await hub.receive_user_message(conversation.id, "@review_model analyze this")
    assert r3.assigned_agent.id == qa_agent.id
    assert r3.task.assigned_agent_id == qa_agent.id
    await complete_task(r3.task.id)

    # 4. Mention by role alias
    r4 = await hub.receive_user_message(conversation.id, "@前端 请优化布局")
    assert r4.assigned_agent.id == fe_agent.id
    assert r4.task.assigned_agent_id == fe_agent.id
    assert r4.assigned_agent.model_name == "code_model"
    await complete_task(r4.task.id)

    # 5. Mention with fullwidth ＠
    r5 = await hub.receive_user_message(conversation.id, "＠前端设计师 更新样式")
    assert r5.assigned_agent.id == fe_agent.id
    assert r5.task.assigned_agent_id == fe_agent.id
    await complete_task(r5.task.id)

    # 6. Mention embedded in Chinese text without spaces
    r6 = await hub.receive_user_message(conversation.id, "这个功能@测试专员请复核")
    assert r6.assigned_agent.id == qa_agent.id
    assert r6.task.assigned_agent_id == qa_agent.id
    await complete_task(r6.task.id)

    # 7. Mention by alias @后端 routes to backend model
    r7 = await hub.receive_user_message(conversation.id, "@后端 实现API服务")
    assert r7.assigned_agent.id == be_agent.id
    assert r7.task.assigned_agent_id == be_agent.id
    assert r7.assigned_agent.model_name == "backend_model"
    await complete_task(r7.task.id)

    # 8. Chinese text with internal agent mentioned before external integration node
    r8 = await hub.receive_user_message(
        conversation.id, "这个任务给@测试专员做，不用@Cursor"
    )
    assert r8.assigned_agent.id == qa_agent.id
    assert r8.task.assigned_agent_id == qa_agent.id
    await complete_task(r8.task.id)

    # 9. Email address in message does not trigger mention, valid mention follows
    r9 = await hub.receive_user_message(
        conversation.id, "联系邮箱 support@example.com，请@后端 处理"
    )
    assert r9.assigned_agent.id == be_agent.id
    assert r9.task.assigned_agent_id == be_agent.id
    await complete_task(r9.task.id)

    # 10. External integration node mentioned before internal agent routes to node
    r10 = await hub.receive_user_message(
        conversation.id, "请让@Cursor先处理，随后交给@测试专员"
    )
    assert r10.assigned_agent is None
    assert r10.task.assigned_agent_id is None
    await complete_task(r10.task.id)


@pytest.mark.asyncio
async def test_empty_workspace_agents_raises_error(message_hub_session) -> None:
    workspace = Workspace(name="Empty workspace", description="no agents")
    message_hub_session.add(workspace)
    await message_hub_session.flush()
    conversation = Conversation(workspace_id=workspace.id, title="Empty chat")
    message_hub_session.add(conversation)
    await message_hub_session.commit()

    hub = MessageHub(message_hub_session, dispatcher=lambda tid: None)
    with pytest.raises(AppError) as exc_info:
        await hub.receive_user_message(conversation.id, "你好")
    assert exc_info.value.status_code == 400
    assert "no available agents" in exc_info.value.message
