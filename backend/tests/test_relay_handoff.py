"""群聊多 Agent 接力（relay handoff）测试。

覆盖 PRD-群聊多Agent接力协作 的 AC1–AC4：多 @ 解析成链、逐棒执行与 PASS
静默、失败收敛、实时进度事件、快照字段与脏数据容错。
"""

import json
from unittest.mock import AsyncMock, patch

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.message_hub import MessageHub
from app.core.orchestrator import AgentOrchestrator
from app.core.relay import (
    MAX_RELAY_AGENTS,
    dump_relay_agent_ids,
    is_pass_reply,
    parse_relay_agent_ids,
)
from app.db.base import Base
from app.models import (
    Agent,
    Conversation,
    IntegrationNode,
    Message,
    ModelCall,
    Task,
    TaskStatus,
    TaskStep,
    Workspace,
)
from app.schemas import TaskRead
from app.services.litellm_service import (
    ChatCompletionResult,
    ModelAttemptFailure,
    ModelCallError,
    TokenUsage,
)
from app.websocket.snapshot import WorkspaceSnapshotBuilder


class RecordingBroadcaster:
    def __init__(self) -> None:
        self.events: list[tuple[int, dict]] = []

    async def broadcast_to_workspace(self, workspace_id: int, event: dict) -> None:
        self.events.append((workspace_id, event))


class RecordingDispatcher:
    def __init__(self) -> None:
        self.calls: list[int] = []

    def __call__(self, task_id: int) -> None:
        self.calls.append(task_id)


def completion(content: str, model_name: str, tokens: int = 10) -> ChatCompletionResult:
    return ChatCompletionResult(
        content=content,
        usage=TokenUsage(
            prompt_tokens=tokens,
            completion_tokens=3,
            total_tokens=tokens + 3,
        ),
        provider="test",
        model_name=f"test/{model_name}",
        requested_model=model_name,
        latency_ms=20,
        fallback_used=False,
    )


@pytest_asyncio.fixture
async def relay_session(tmp_path):
    database_path = tmp_path / "relay-test.db"
    engine = create_async_engine(f"sqlite+aiosqlite:///{database_path.as_posix()}")
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with session_factory() as session:
        yield session
    await engine.dispose()


async def create_workspace_graph(session) -> tuple[dict[str, Agent], Conversation]:
    workspace = Workspace(name="Relay workspace", description="tests")
    conversation = Conversation(workspace=workspace, title="Relay chat")
    session.add_all([workspace, conversation])
    await session.flush()
    definitions = [
        ("项目总设计师", "project_architect", "manager_model"),
        ("Agent工程师", "agent_engineer", "code_model"),
        ("前端设计师", "frontend_designer", "code_model"),
        ("知识库管理员", "knowledge_manager", "writing_model"),
        ("测试专员", "qa_engineer", "review_model"),
        ("运维", "operations_engineer", "code_model"),
    ]
    agents = {
        name: Agent(
            workspace_id=workspace.id,
            name=name,
            role=role,
            model_name=model_name,
            system_prompt=f"System prompt for {name}",
            status="idle",
        )
        for name, role, model_name in definitions
    }
    session.add_all(agents.values())
    await session.commit()
    return agents, conversation


async def complete_task(session, task_id: int) -> None:
    task = await session.get(Task, task_id)
    if task is not None:
        task.status = TaskStatus.COMPLETED
        await session.commit()


def progress_events(broadcaster: RecordingBroadcaster) -> list[dict]:
    return [
        event["payload"]
        for _, event in broadcaster.events
        if event["type"] == "task.relay_progress"
    ]


def test_relay_agent_ids_roundtrip_and_dirty_data() -> None:
    assert parse_relay_agent_ids(None) == []
    assert parse_relay_agent_ids("") == []
    assert parse_relay_agent_ids("not-json") == []
    assert parse_relay_agent_ids('{"a": 1}') == []
    assert parse_relay_agent_ids('["3", "2"]') == []
    assert parse_relay_agent_ids("[0, -1]") == []
    assert parse_relay_agent_ids("[3, 2, 3]") == [3, 2]
    assert parse_relay_agent_ids("[true, 2]") == []
    long_chain = list(range(1, MAX_RELAY_AGENTS + 3))
    assert parse_relay_agent_ids(json.dumps(long_chain)) == long_chain[:MAX_RELAY_AGENTS]

    assert dump_relay_agent_ids([]) is None
    assert dump_relay_agent_ids([7]) is None
    assert dump_relay_agent_ids([3, 3, 5]) == "[3,5]"
    assert dump_relay_agent_ids([0, 2, 4]) == "[2,4]"


def test_pass_marker_detection() -> None:
    for value in [
        "[PASS]",
        "  [pass]  ",
        "【PASS】",
        "(PASS)",
        "（pass）",
        "pass",
        "PASS.",
        "pass!",
        "",
        "   ",
        None,
    ]:
        assert is_pass_reply(value) is True, value
    for value in [
        "PASS 之后我继续补充其他内容",
        "本棒产出包含 [PASS] 标记",
        "已完成：无需补充",
    ]:
        assert is_pass_reply(value) is False, value


@pytest.mark.asyncio
async def test_multi_mention_creates_ordered_relay_task(relay_session) -> None:
    agents, conversation = await create_workspace_graph(relay_session)
    broadcaster = RecordingBroadcaster()
    dispatcher = RecordingDispatcher()
    hub = MessageHub(
        relay_session, broadcaster=broadcaster, dispatcher=dispatcher
    )

    result = await hub.receive_user_message(
        conversation.id,
        "@项目总设计师 @前端设计师 @测试专员 请按顺序接力完成需求",
    )

    expected_chain = [
        agents["项目总设计师"].id,
        agents["前端设计师"].id,
        agents["测试专员"].id,
    ]
    assert result.assigned_agent is not None
    assert result.assigned_agent.id == expected_chain[0]
    assert result.task.assigned_agent_id == expected_chain[0]
    assert result.task.relay_agent_ids == expected_chain
    assert dispatcher.calls == [result.task.id]
    assert [event[1]["type"] for event in broadcaster.events] == [
        "message.created",
        "task.status_changed",
    ]
    # 用户消息保持完整原文（@ 全部保留），任务描述同样保留。
    assert "@测试专员" in result.message.content

    stored = await relay_session.get(Task, result.task.id)
    assert stored is not None
    assert stored.relay_agent_ids_json == json.dumps(
        expected_chain, separators=(",", ":")
    )
    assert TaskRead.model_validate(stored).relay_agent_ids == expected_chain


@pytest.mark.asyncio
async def test_single_mention_and_no_mention_keep_plain_task(relay_session) -> None:
    agents, conversation = await create_workspace_graph(relay_session)
    hub = MessageHub(
        relay_session,
        broadcaster=RecordingBroadcaster(),
        dispatcher=RecordingDispatcher(),
    )

    single = await hub.receive_user_message(conversation.id, "@测试专员 执行回归测试")
    await complete_task(relay_session, single.task.id)
    assert single.task.assigned_agent_id == agents["测试专员"].id
    assert single.task.relay_agent_ids == []

    plain = await hub.receive_user_message(conversation.id, "整理这次需求")
    await complete_task(relay_session, plain.task.id)
    assert plain.task.assigned_agent_id == agents["项目总设计师"].id
    assert plain.task.relay_agent_ids == []


@pytest.mark.asyncio
async def test_duplicate_mentions_are_deduped_and_aliases_resolve(relay_session) -> None:
    agents, conversation = await create_workspace_graph(relay_session)
    hub = MessageHub(
        relay_session,
        broadcaster=RecordingBroadcaster(),
        dispatcher=RecordingDispatcher(),
    )

    deduped = await hub.receive_user_message(
        conversation.id,
        "@前端设计师 先做界面，@前端设计师 再补细节，最后 @测试 验收",
    )
    await complete_task(relay_session, deduped.task.id)
    assert deduped.task.relay_agent_ids == [
        agents["前端设计师"].id,
        agents["测试专员"].id,
    ]
    assert deduped.task.assigned_agent_id == agents["前端设计师"].id


@pytest.mark.asyncio
async def test_first_mention_integration_node_keeps_node_dispatch(relay_session) -> None:
    agents, conversation = await create_workspace_graph(relay_session)
    node = IntegrationNode(
        workspace_id=conversation.workspace_id,
        name="Cursor",
        provider="cursor",
        mode="bridge",
        status="online",
        current_task_count=0,
        max_concurrency=1,
    )
    relay_session.add(node)
    await relay_session.commit()
    hub = MessageHub(
        relay_session,
        broadcaster=RecordingBroadcaster(),
        dispatcher=RecordingDispatcher(),
    )

    result = await hub.receive_user_message(
        conversation.id, "@Cursor 先处理，随后交给 @前端设计师 继续"
    )
    assert result.assigned_agent is None
    assert result.task.assigned_agent_id is None
    assert result.task.relay_agent_ids == []


async def _create_relay_task(session, agents: dict[str, Agent], conversation: Conversation, chain: list[int]) -> Task:
    task = Task(
        workspace_id=conversation.workspace_id,
        conversation_id=conversation.id,
        title="Relay task",
        description="@前端设计师 @测试专员 请接力完成登录页面",
        assigned_agent_id=chain[0],
        status=TaskStatus.PENDING,
        relay_agent_ids_json=json.dumps(chain, separators=(",", ":")),
    )
    session.add(task)
    await session.commit()
    await session.refresh(task)
    return task


@pytest.mark.asyncio
async def test_relay_task_runs_hops_in_order(relay_session) -> None:
    agents, conversation = await create_workspace_graph(relay_session)
    chain = [
        agents["前端设计师"].id,
        agents["测试专员"].id,
        agents["项目总设计师"].id,
    ]
    task = await _create_relay_task(relay_session, agents, conversation, chain)
    broadcaster = RecordingBroadcaster()
    outputs = [
        completion("登录页面已实现，包含加载与错误态。", "code_model", 21),
        completion("验收通过，建议补充端到端用例。", "review_model", 24),
        completion("最终结论：可交付并持续跟进测试。", "manager_model", 27),
    ]

    with patch(
        "app.services.litellm_service.chat_completion",
        new=AsyncMock(side_effect=outputs),
    ) as model_call:
        result = await AgentOrchestrator(relay_session, broadcaster).run_task(task.id)

    assert result.status == TaskStatus.COMPLETED
    assert [call.args[0] for call in model_call.await_args_list] == [
        "code_model",
        "review_model",
        "manager_model",
    ]
    assert all(
        "前序产出" in call.args[1][-1]["content"]
        for call in model_call.await_args_list
    )
    assert "第 2 棒" in model_call.await_args_list[1].args[1][-1]["content"]
    assert "登录页面已实现" in model_call.await_args_list[1].args[1][-1]["content"]

    steps = list(
        await relay_session.scalars(
            select(TaskStep).where(TaskStep.task_id == task.id).order_by(TaskStep.id)
        )
    )
    assert [step.step_name for step in steps] == [
        "relay_turn_1",
        "relay_turn_2",
        "relay_turn_3",
    ]
    assert [step.agent_id for step in steps] == chain
    assert all(step.status == "completed" for step in steps)
    assert [step.output for step in steps] == [item.content for item in outputs]

    calls = list(
        await relay_session.scalars(
            select(ModelCall).where(ModelCall.task_id == task.id).order_by(ModelCall.id)
        )
    )
    assert [call.agent_id for call in calls] == chain

    messages = list(
        await relay_session.scalars(
            select(Message)
            .where(Message.conversation_id == conversation.id)
            .order_by(Message.id)
        )
    )
    assert [message.sender_id for message in messages] == chain
    assert [message.content for message in messages] == [item.content for item in outputs]

    progress = progress_events(broadcaster)
    assert [item["status"] for item in progress] == [
        "started",
        "completed",
        "started",
        "completed",
        "started",
        "completed",
    ]
    assert [item["hop_index"] for item in progress] == [1, 1, 2, 2, 3, 3]
    assert all(item["total_hops"] == 3 for item in progress)
    task_after = await relay_session.get(Task, task.id)
    assert task_after is not None
    assert all(output.content[:6] in (task_after.result or "") for output in outputs)
    assert "第 2 棒" not in (task_after.result or "")


@pytest.mark.asyncio
async def test_pass_hop_is_silent_but_recorded(relay_session) -> None:
    agents, conversation = await create_workspace_graph(relay_session)
    chain = [agents["前端设计师"].id, agents["测试专员"].id, agents["运维"].id]
    task = await _create_relay_task(relay_session, agents, conversation, chain)
    broadcaster = RecordingBroadcaster()
    outputs = [
        completion("页面已完成。", "code_model"),
        completion("[PASS]", "review_model"),
        completion("部署清单已就绪。", "code_model"),
    ]

    with patch(
        "app.services.litellm_service.chat_completion",
        new=AsyncMock(side_effect=outputs),
    ):
        result = await AgentOrchestrator(relay_session, broadcaster).run_task(task.id)

    assert result.status == TaskStatus.COMPLETED
    messages = list(
        await relay_session.scalars(
            select(Message)
            .where(Message.conversation_id == conversation.id)
            .order_by(Message.id)
        )
    )
    assert [message.sender_id for message in messages] == [
        agents["前端设计师"].id,
        agents["运维"].id,
    ]
    steps = list(
        await relay_session.scalars(
            select(TaskStep).where(TaskStep.task_id == task.id).order_by(TaskStep.id)
        )
    )
    assert [step.output for step in steps] == [
        "页面已完成。",
        "[PASS]",
        "部署清单已就绪。",
    ]
    assert [item["status"] for item in progress_events(broadcaster)] == [
        "started",
        "completed",
        "started",
        "passed",
        "started",
        "completed",
    ]
    assert "页面已完成" in (result.result or "")
    assert "部署清单已就绪" in (result.result or "")


@pytest.mark.asyncio
async def test_relay_hop_failure_keeps_earlier_outputs(relay_session) -> None:
    agents, conversation = await create_workspace_graph(relay_session)
    chain = [agents["前端设计师"].id, agents["测试专员"].id]
    task = await _create_relay_task(relay_session, agents, conversation, chain)
    broadcaster = RecordingBroadcaster()
    failure = ModelCallError(
        "review_model",
        [
            ModelAttemptFailure(
                provider="test",
                model_name="test/review_model",
                message="review timeout",
                latency_ms=60,
            )
        ],
    )

    with patch(
        "app.services.litellm_service.chat_completion",
        new=AsyncMock(
            side_effect=[completion("页面已完成。", "code_model"), failure]
        ),
    ):
        result = await AgentOrchestrator(relay_session, broadcaster).run_task(task.id)

    assert result.status == TaskStatus.FAILED
    assert "review timeout" in (result.result or "")
    messages = list(
        await relay_session.scalars(
            select(Message)
            .where(Message.conversation_id == conversation.id)
            .order_by(Message.id)
        )
    )
    # 第一棒成果保留，第二棒失败产生错误消息。
    assert len(messages) == 2
    assert messages[0].content == "页面已完成。"
    assert messages[1].message_type.value == "error"
    steps = list(
        await relay_session.scalars(
            select(TaskStep).where(TaskStep.task_id == task.id).order_by(TaskStep.id)
        )
    )
    assert [(step.step_name, step.status) for step in steps] == [
        ("relay_turn_1", "completed"),
        ("relay_turn_2", "failed"),
    ]
    statuses = [item["status"] for item in progress_events(broadcaster)]
    assert statuses[-1] == "failed"
    await relay_session.refresh(agents["前端设计师"])
    await relay_session.refresh(agents["测试专员"])
    assert agents["前端设计师"].status == "idle"
    assert agents["测试专员"].status == "failed"


@pytest.mark.asyncio
async def test_relay_missing_agent_fails_fast(relay_session) -> None:
    agents, conversation = await create_workspace_graph(relay_session)
    task = await _create_relay_task(
        relay_session,
        agents,
        conversation,
        [agents["前端设计师"].id, 999999],
    )

    with patch(
        "app.services.litellm_service.chat_completion",
        new=AsyncMock(side_effect=AssertionError("model must not be called")),
    ):
        result = await AgentOrchestrator(
            relay_session, RecordingBroadcaster()
        ).run_task(task.id)

    assert result.status == TaskStatus.FAILED
    assert "not available" in (result.result or "")


@pytest.mark.asyncio
async def test_workspace_snapshot_carries_relay_chain(relay_session) -> None:
    agents, conversation = await create_workspace_graph(relay_session)
    chain = [agents["前端设计师"].id, agents["测试专员"].id]
    task = await _create_relay_task(relay_session, agents, conversation, chain)
    snapshot = await WorkspaceSnapshotBuilder(relay_session).build_snapshot(
        conversation.workspace_id
    )
    payload = next(item for item in snapshot["tasks"] if item["id"] == task.id)
    assert payload["relay_agent_ids"] == chain

