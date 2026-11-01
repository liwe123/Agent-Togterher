"""REQ-D4 执行级预算与 REQ-D6 内容级脱敏的回归测试。

覆盖：脱敏规则/开关、群聊入口脱敏与路由不受影响、orchestrator 落库脱敏、
内部工具循环轮次预算、refresh token 无服务端记录拒绝。
"""

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from unittest.mock import AsyncMock, patch

from app.core.auth import create_refresh_token
from app.core.config import get_settings
from app.core.message_hub import MessageHub
from app.core.orchestrator import AgentOrchestrator
from app.core.redaction import redact_content
from app.db.base import Base
from app.db.session import get_db
from app.main import app
from app.models import (
    Agent,
    Conversation,
    Message,
    Task,
    TaskStatus,
    TaskStep,
    Workspace,
)
from app.services.litellm_service import ChatCompletionResult, TokenUsage

OPENAI_KEY = "sk-abcdefghijklmnopqrstuvwxyz012345"


class RecordingBroadcaster:
    def __init__(self) -> None:
        self.events: list[tuple[int, dict]] = []

    async def broadcast_to_workspace(self, workspace_id: int, event: dict) -> None:
        self.events.append((workspace_id, event))


def completion(content: str, *, tool_calls: list[dict] | None = None) -> ChatCompletionResult:
    return ChatCompletionResult(
        content=content,
        usage=TokenUsage(prompt_tokens=10, completion_tokens=5, total_tokens=15),
        provider="test",
        model_name="test/model",
        requested_model="code_model",
        latency_ms=10,
        fallback_used=False,
        tool_calls=tool_calls or [],
    )


async def create_graph(session) -> tuple[Workspace, Conversation, Agent, Agent, Task]:
    workspace = Workspace(name="Redaction workspace", description="tests")
    session.add(workspace)
    await session.flush()
    qa = Agent(
        workspace_id=workspace.id,
        name="测试专员",
        role="qa_engineer",
        model_name="review_model",
        system_prompt="QA",
        status="idle",
    )
    worker = Agent(
        workspace_id=workspace.id,
        name="执行者",
        role="worker",
        model_name="code_model",
        system_prompt="Executor",
        status="idle",
    )
    conversation = Conversation(workspace_id=workspace.id, title="Chat")
    session.add_all([qa, worker, conversation])
    await session.flush()
    task = Task(
        workspace_id=workspace.id,
        conversation_id=conversation.id,
        title="Task",
        description="Do work",
        assigned_agent_id=worker.id,
        status=TaskStatus.PENDING,
    )
    session.add(task)
    await session.commit()
    return workspace, conversation, qa, worker, task


def test_redaction_rules_cover_common_secrets() -> None:
    raw = (
        f"key={OPENAI_KEY} aws=AKIAABCDEFGHIJKLMNOP "
        "gh=ghp_abcdefghijklmnopqrstuvwxyz0123 "
        "auth=Bearer abcdefghijklmnopqrstuvwxyz012345 "
        "password=hunter2secret "
        "private=-----BEGIN RSA PRIVATE KEY-----MIIBOgIBAAJBAK-----END RSA PRIVATE KEY-----"
    )
    redacted = redact_content(raw)
    assert redacted is not None
    assert OPENAI_KEY not in redacted
    assert "AKIAABCDEFGHIJKLMNOP" not in redacted
    assert "ghp_abcdefghijklmnopqrstuvwxyz0123" not in redacted
    assert "abcdefghijklmnopqrstuvwxyz012345" not in redacted
    assert "hunter2secret" not in redacted
    assert "MIIBOgIBAAJBAK" not in redacted
    assert "[REDACTED:openai_key]" in redacted
    assert "[REDACTED:private_key]" in redacted
    assert "[REDACTED:assigned_secret]" in redacted


def test_redaction_passthrough_and_multiple_occurrences() -> None:
    assert redact_content(None) is None
    assert redact_content("") == ""
    assert redact_content("普通文本，没有敏感信息") == "普通文本，没有敏感信息"
    two = f"{OPENAI_KEY} 和 {OPENAI_KEY}"
    redacted = redact_content(two)
    assert redacted is not None
    assert redacted.count("[REDACTED:openai_key]") == 2


def test_redaction_can_be_disabled(monkeypatch) -> None:
    monkeypatch.setattr(get_settings(), "content_redaction_enabled", False)
    assert redact_content(OPENAI_KEY) == OPENAI_KEY


@pytest.mark.asyncio
async def test_message_hub_redacts_content_but_routes_mentions(db_session) -> None:
    _workspace, conversation, qa, _worker, _task = await create_graph(db_session)
    broadcaster = RecordingBroadcaster()
    dispatched: list[int] = []
    hub = MessageHub(
        db_session,
        broadcaster=broadcaster,
        dispatcher=lambda task_id: dispatched.append(task_id),
    )
    result = await hub.receive_user_message(
        conversation.id, f"@测试专员 帮我看看这个 key：{OPENAI_KEY}"
    )
    assert result.assigned_agent is not None
    assert result.assigned_agent.id == qa.id
    assert dispatched == [result.task.id]
    assert OPENAI_KEY not in result.message.content
    assert "[REDACTED:openai_key]" in result.message.content
    stored_message = await db_session.get(Message, result.message.id)
    stored_task = await db_session.get(Task, result.task.id)
    assert stored_message is not None and OPENAI_KEY not in stored_message.content
    assert stored_task is not None and OPENAI_KEY not in stored_task.description
    assert stored_task.assigned_agent_id == qa.id


@pytest.mark.asyncio
async def test_orchestrator_redacts_result_and_step_output(db_session) -> None:
    _workspace, _conversation, _qa, worker, task = await create_graph(db_session)
    leaky = completion(f"实现完成，配置里用了 {OPENAI_KEY}，请妥善保管。")
    broadcaster = RecordingBroadcaster()
    with patch(
        "app.core.orchestrator.litellm_service.chat_completion",
        new=AsyncMock(return_value=leaky),
    ):
        result = await AgentOrchestrator(db_session, broadcaster).run_task(task.id)
    assert result.status == TaskStatus.COMPLETED
    messages = list(
        await db_session.scalars(select(Message).where(Message.conversation_id == task.conversation_id))
    )
    assert len(messages) == 1
    assert OPENAI_KEY not in messages[0].content
    assert "[REDACTED:openai_key]" in messages[0].content
    steps = list(await db_session.scalars(select(TaskStep).where(TaskStep.task_id == task.id)))
    step_outputs = "\n".join(step.output or "" for step in steps)
    assert OPENAI_KEY not in step_outputs
    refreshed = await db_session.get(Task, task.id)
    assert refreshed is not None and refreshed.result is not None
    assert OPENAI_KEY not in refreshed.result


@pytest.mark.asyncio
async def test_tool_loop_respects_configured_max_iterations(db_session, monkeypatch) -> None:
    monkeypatch.setattr(get_settings(), "agent_max_tool_iterations", 2)
    _workspace, _conversation, _qa, _worker, task = await create_graph(db_session)
    always_tool = completion(
        "",
        tool_calls=[{"id": "call-1", "name": "calculate", "arguments": "{\"expression\": \"1+1\"}"}],
    )
    broadcaster = RecordingBroadcaster()
    with patch(
        "app.core.orchestrator.litellm_service.chat_completion",
        new=AsyncMock(return_value=always_tool),
    ):
        result = await AgentOrchestrator(db_session, broadcaster).run_task(task.id)
    assert result.status == TaskStatus.FAILED
    assert "after 2 rounds" in (result.result or "")


@pytest.fixture
def auth_client(tmp_path) -> Iterator[TestClient]:
    database_path = tmp_path / "budget-redaction-auth.db"
    engine = create_async_engine(f"sqlite+aiosqlite:///{database_path.as_posix()}")
    session_factory = async_sessionmaker(engine, expire_on_commit=False)

    async def create_schema() -> None:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)

    async def override_get_db():
        async with session_factory() as session:
            yield session

    import asyncio

    asyncio.run(create_schema())
    app.dependency_overrides[get_db] = override_get_db
    try:
        with TestClient(app) as client:
            yield client
    finally:
        app.dependency_overrides.clear()
        asyncio.run(engine.dispose())


def test_refresh_token_without_server_record_is_rejected(auth_client: TestClient) -> None:
    register = auth_client.post(
        "/api/v1/auth/register",
        json={
            "email": "budget-redaction@example.com",
            "password": "Password123!",
            "display_name": "Budget Redaction",
        },
    )
    assert register.status_code == 200
    user_id = register.json()["data"]["user"]["id"]
    # 合法签名但服务端没有 RefreshToken 记录 —— 旧实现会放行，修复后必须 401。
    orphan_token = create_refresh_token(user_id)
    refresh = auth_client.post(
        "/api/v1/auth/refresh",
        json={"refresh_token": orphan_token},
    )
    assert refresh.status_code == 401


@pytest.mark.asyncio
async def test_worker_subtasks_run_concurrently_when_tools_disabled(
    db_session, monkeypatch
) -> None:
    import asyncio
    import json

    monkeypatch.setattr(get_settings(), "agent_tools_enabled", False)
    monkeypatch.setattr(get_settings(), "agent_worker_parallelism", 2)

    workspace = Workspace(name="Parallel workspace", description="tests")
    db_session.add(workspace)
    await db_session.flush()
    manager = Agent(
        workspace_id=workspace.id,
        name="项目总设计师",
        role="project_architect",
        model_name="manager_model",
        system_prompt="Manager",
        status="idle",
    )
    frontend = Agent(
        workspace_id=workspace.id,
        name="前端设计师",
        role="frontend_designer",
        model_name="code_model",
        system_prompt="Frontend",
        status="idle",
    )
    backend = Agent(
        workspace_id=workspace.id,
        name="Agent工程师",
        role="agent_engineer",
        model_name="code_model",
        system_prompt="Backend",
        status="idle",
    )
    qa = Agent(
        workspace_id=workspace.id,
        name="测试专员",
        role="qa_engineer",
        model_name="review_model",
        system_prompt="QA",
        status="idle",
    )
    conversation = Conversation(workspace_id=workspace.id, title="Parallel chat")
    db_session.add_all([manager, frontend, backend, qa, conversation])
    await db_session.flush()
    task = Task(
        workspace_id=workspace.id,
        conversation_id=conversation.id,
        title="并行子任务",
        description="实现前后端并验收",
        assigned_agent_id=manager.id,
        status=TaskStatus.PENDING,
    )
    db_session.add(task)
    await db_session.commit()

    plan_json = json.dumps(
        {
            "task_summary": "并行实现前后端",
            "subtasks": [
                {
                    "id": 1,
                    "title": "前端页面",
                    "description": "实现页面",
                    "task_type": "frontend",
                    "agent": "前端设计师",
                },
                {
                    "id": 2,
                    "title": "后端接口",
                    "description": "实现接口",
                    "task_type": "backend",
                    "agent": "Agent工程师",
                },
            ],
        },
        ensure_ascii=False,
    )
    counter = {"active": 0, "max_active": 0, "manager_calls": 0}

    async def fake_chat_completion(model_name, messages, **kwargs):
        if model_name == "manager_model":
            counter["manager_calls"] += 1
            if counter["manager_calls"] == 1:
                return completion(plan_json)
            return completion("最终交付说明")
        if model_name == "review_model":
            return completion("审核通过")
        counter["active"] += 1
        counter["max_active"] = max(counter["max_active"], counter["active"])
        await asyncio.sleep(0.05)
        counter["active"] -= 1
        return completion(f"worker done: {messages[-1]['content'][:16]}")

    with patch(
        "app.core.orchestrator.litellm_service.chat_completion",
        new=AsyncMock(side_effect=fake_chat_completion),
    ):
        result = await AgentOrchestrator(
            db_session, RecordingBroadcaster()
        ).run_task(task.id)

    assert result.status == TaskStatus.COMPLETED, result.result
    assert counter["max_active"] >= 2
    steps = list(
        await db_session.scalars(
            select(TaskStep)
            .where(TaskStep.task_id == task.id)
            .order_by(TaskStep.id)
        )
    )
    worker_steps = [step for step in steps if step.step_name.startswith("worker_execute_")]
    assert len(worker_steps) == 2
    assert all(step.status == "completed" for step in worker_steps)
