import json
from unittest.mock import AsyncMock, patch

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.agents.manager_agent import ManagerPlanError, parse_manager_plan
from app.agents.worker_agent import worker_name_for_task_type
from app.core.orchestrator import AgentOrchestrator
from app.db.base import Base
from app.models import (
    Agent,
    Conversation,
    Message,
    MessageType,
    ModelCall,
    Task,
    TaskStatus,
    TaskStep,
    Workspace,
)
from app.services.litellm_service import (
    ChatCompletionResult,
    ModelAttemptFailure,
    ModelCallError,
    TokenUsage,
)


class RecordingBroadcaster:
    def __init__(self) -> None:
        self.events: list[tuple[int, dict]] = []

    async def broadcast_to_workspace(self, workspace_id: int, event: dict) -> None:
        self.events.append((workspace_id, event))


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


async def create_multi_agent_graph(session) -> tuple[dict[str, Agent], Task]:
    workspace = Workspace(name="Multi-Agent workspace", description="tests")
    conversation = Conversation(workspace=workspace, title="Workflow chat")
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
    await session.flush()

    task = Task(
        workspace_id=workspace.id,
        conversation_id=conversation.id,
        title="Build feature",
        description="@项目总设计师 实现一个带 API 的响应式管理页面并完成测试。",
        assigned_agent_id=agents["项目总设计师"].id,
        status=TaskStatus.PENDING,
    )
    session.add(task)
    await session.commit()
    return agents, task


@pytest_asyncio.fixture
async def workflow_session(tmp_path):
    database_path = tmp_path / "multi-agent-test.db"
    engine = create_async_engine(f"sqlite+aiosqlite:///{database_path.as_posix()}")
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with session_factory() as session:
        yield session
    await engine.dispose()


def test_manager_plan_validation_and_worker_mapping() -> None:
    fenced_plan = """```json
{
  "task_summary": "实现完整功能",
  "subtasks": [
    {"id": 1, "title": "界面", "description": "实现页面", "task_type": "frontend", "agent": "前端设计师"},
    {"id": 2, "title": "部署", "description": "编写 Docker 配置", "task_type": "deployment", "agent": "运维"}
  ]
}
```"""
    plan = parse_manager_plan(fenced_plan)
    assert [item.agent for item in plan.subtasks] == ["前端设计师", "运维"]
    assert worker_name_for_task_type("frontend") == "前端设计师"
    assert worker_name_for_task_type("backend") == "Agent工程师"
    assert worker_name_for_task_type("knowledge") == "知识库管理员"
    assert worker_name_for_task_type("deployment") == "运维"

    invalid_mapping = json.loads(fenced_plan.removeprefix("```json\n").removesuffix("\n```"))
    invalid_mapping["subtasks"][0]["agent"] = "运维"
    with pytest.raises(ManagerPlanError, match="must use agent"):
        parse_manager_plan(json.dumps(invalid_mapping, ensure_ascii=False))


@pytest.mark.asyncio
async def test_manager_task_runs_full_multi_agent_workflow(workflow_session) -> None:
    agents, task = await create_multi_agent_graph(workflow_session)
    broadcaster = RecordingBroadcaster()
    plan_json = json.dumps(
        {
            "task_summary": "实现管理页面和配套 API",
            "subtasks": [
                {
                    "id": 1,
                    "title": "实现响应式页面",
                    "description": "完成管理页面和交互状态",
                    "task_type": "frontend",
                    "agent": "前端设计师",
                },
                {
                    "id": 2,
                    "title": "实现 API",
                    "description": "完成后端接口和 Agent 逻辑",
                    "task_type": "backend",
                    "agent": "Agent工程师",
                },
            ],
        },
        ensure_ascii=False,
    )
    completions = [
        completion(plan_json, "manager_model", 30),
        completion("页面已实现并覆盖加载、空态和错误态。", "code_model", 21),
        completion("API 已实现并包含参数校验。", "code_model", 24),
        completion("结论：通过。建议补充端到端测试。", "review_model", 27),
        completion("功能已完成；已记录端到端测试建议。", "manager_model", 32),
    ]

    with patch(
        "app.services.litellm_service.chat_completion",
        new=AsyncMock(side_effect=completions),
    ) as model_call:
        result = await AgentOrchestrator(
            workflow_session, broadcaster
        ).run_task(task.id)

    assert result.status == TaskStatus.COMPLETED
    assert result.result == completions[-1].content
    assert model_call.await_count == 5
    assert [call.args[0] for call in model_call.await_args_list] == [
        "manager_model",
        "code_model",
        "code_model",
        "review_model",
        "manager_model",
    ]

    steps = list(
        await workflow_session.scalars(
            select(TaskStep).where(TaskStep.task_id == task.id).order_by(TaskStep.id)
        )
    )
    assert [step.step_name for step in steps] == [
        "manager_plan",
        "worker_execute_1",
        "worker_execute_2",
        "review_results",
        "final_summary",
    ]
    assert all(step.status == "completed" for step in steps)
    assert all(step.started_at is not None and step.finished_at is not None for step in steps)
    assert json.loads(steps[0].output or "{}")["subtasks"][1]["agent"] == "Agent工程师"

    calls = list(
        await workflow_session.scalars(
            select(ModelCall).where(ModelCall.task_id == task.id).order_by(ModelCall.id)
        )
    )
    assert len(calls) == 5
    assert [call.agent_id for call in calls] == [
        agents["项目总设计师"].id,
        agents["前端设计师"].id,
        agents["Agent工程师"].id,
        agents["测试专员"].id,
        agents["项目总设计师"].id,
    ]
    assert all(call.status == "completed" for call in calls)

    messages = list(
        await workflow_session.scalars(
            select(Message)
            .where(Message.conversation_id == task.conversation_id)
            .order_by(Message.id)
        )
    )
    assert len(messages) == 5
    assert [message.content.splitlines()[0] for message in messages] == [
        "【任务拆解】",
        "【Agent 执行结果 1/2】",
        "【Agent 执行结果 2/2】",
        "【测试专员审核】",
        "【最终汇总】",
    ]
    assert all(message.message_type == MessageType.NORMAL for message in messages)

    for agent in agents.values():
        await workflow_session.refresh(agent)
        assert agent.status == "idle"

    event_types = [event[1]["type"] for event in broadcaster.events]
    assert event_types.count("task.step_changed") == 10
    assert event_types.count("model.call_finished") == 5
    assert event_types.count("message.created") == 5
    assert event_types.count("task.status_changed") == 2
    assert event_types[-1] == "message.created"
    step_statuses = [
        event[1]["payload"]["status"]
        for event in broadcaster.events
        if event[1]["type"] == "task.step_changed"
    ]
    assert step_statuses == ["running", "completed"] * 5


@pytest.mark.asyncio
async def test_invalid_manager_json_is_logged_and_fails_task(workflow_session) -> None:
    agents, task = await create_multi_agent_graph(workflow_session)
    broadcaster = RecordingBroadcaster()
    manager_response = completion("not valid json", "manager_model")

    with patch(
        "app.services.litellm_service.chat_completion",
        new=AsyncMock(return_value=manager_response),
    ):
        result = await AgentOrchestrator(
            workflow_session, broadcaster
        ).run_task(task.id)

    assert result.status == TaskStatus.FAILED
    assert "invalid JSON plan" in (result.result or "")
    steps = list(
        await workflow_session.scalars(
            select(TaskStep).where(TaskStep.task_id == task.id)
        )
    )
    calls = list(
        await workflow_session.scalars(
            select(ModelCall).where(ModelCall.task_id == task.id)
        )
    )
    messages = list(
        await workflow_session.scalars(
            select(Message).where(Message.conversation_id == task.conversation_id)
        )
    )
    assert len(steps) == 1
    assert steps[0].step_name == "manager_plan"
    assert steps[0].status == "failed"
    assert len(calls) == 1
    assert calls[0].status == "completed"
    assert len(messages) == 1
    assert messages[0].message_type == MessageType.ERROR
    await workflow_session.refresh(agents["项目总设计师"])
    assert agents["项目总设计师"].status == "failed"
    assert broadcaster.events[-1][1]["type"] == "error"


@pytest.mark.asyncio
async def test_worker_model_failure_is_persisted_and_stops_workflow(
    workflow_session,
) -> None:
    agents, task = await create_multi_agent_graph(workflow_session)
    broadcaster = RecordingBroadcaster()
    plan_json = json.dumps(
        {
            "task_summary": "实现 API",
            "subtasks": [
                {
                    "id": 1,
                    "title": "实现 API",
                    "description": "实现并验证接口",
                    "task_type": "backend",
                    "agent": "Agent工程师",
                }
            ],
        },
        ensure_ascii=False,
    )
    worker_error = ModelCallError(
        "code_model",
        [
            ModelAttemptFailure(
                provider="deepseek",
                model_name="deepseek/deepseek-chat",
                message="worker timeout",
                latency_ms=60,
            )
        ],
    )

    with patch(
        "app.services.litellm_service.chat_completion",
        new=AsyncMock(
            side_effect=[completion(plan_json, "manager_model"), worker_error]
        ),
    ):
        result = await AgentOrchestrator(
            workflow_session, broadcaster
        ).run_task(task.id)

    assert result.status == TaskStatus.FAILED
    assert "worker timeout" in (result.result or "")
    steps = list(
        await workflow_session.scalars(
            select(TaskStep).where(TaskStep.task_id == task.id).order_by(TaskStep.id)
        )
    )
    calls = list(
        await workflow_session.scalars(
            select(ModelCall).where(ModelCall.task_id == task.id).order_by(ModelCall.id)
        )
    )
    assert [(step.step_name, step.status) for step in steps] == [
        ("manager_plan", "completed"),
        ("worker_execute_1", "failed"),
    ]
    assert [call.status for call in calls] == ["completed", "failed"]
    assert calls[1].provider == "deepseek"
    assert "worker timeout" in (calls[1].error_message or "")
    await workflow_session.refresh(agents["项目总设计师"])
    await workflow_session.refresh(agents["Agent工程师"])
    assert agents["项目总设计师"].status == "idle"
    assert agents["Agent工程师"].status == "failed"
    assert broadcaster.events[-1][1]["type"] == "error"
