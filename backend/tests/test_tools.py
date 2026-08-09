"""Tests for the function-calling / tools support.

Covers the safe calculator, chat_completion tool surfacing, and the
orchestrator's tool loop (happy path, failing handler, unknown tool, and the
max-iteration guard).
"""

import asyncio
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.config import Settings
from app.core.orchestrator import AgentOrchestrator
from app.db.base import Base
from app.models import Agent, Conversation, Task, TaskStatus, TaskStep, Workspace
from app.services import litellm_service
from app.services.litellm_service import (
    ChatCompletionResult,
    TokenUsage,
)
from app.services.tools import execute_tool, get_tools_spec, safe_eval_expression


ROOT_MODELS_CONFIG = Path(__file__).resolve().parents[2] / "config" / "models.yaml"


def _settings(**values) -> Settings:
    return Settings(
        _env_file=None,
        models_config_path=str(ROOT_MODELS_CONFIG),
        **values,
    )


class RecordingBroadcaster:
    def __init__(self) -> None:
        self.events: list[tuple[int, dict]] = []

    async def broadcast_to_workspace(self, workspace_id: int, event: dict) -> None:
        self.events.append((workspace_id, event))


def completion(
    content: str,
    tool_calls: list[dict] | None = None,
    model_name: str = "deepseek/deepseek-chat",
) -> ChatCompletionResult:
    return ChatCompletionResult(
        content=content,
        usage=TokenUsage(prompt_tokens=8, completion_tokens=3, total_tokens=11),
        provider="deepseek",
        model_name=model_name,
        requested_model="code_model",
        latency_ms=15,
        fallback_used=False,
        tool_calls=tool_calls or [],
    )


async def create_task_graph(session) -> tuple[Agent, Task]:
    workspace = Workspace(name="Tools workspace", description="tests")
    session.add(workspace)
    await session.flush()
    agent = Agent(
        workspace_id=workspace.id,
        name="Executor",
        role="worker",
        model_name="code_model",
        system_prompt="Return a concise implementation result.",
        status="idle",
    )
    conversation = Conversation(workspace_id=workspace.id, title="Task chat")
    session.add_all([agent, conversation])
    await session.flush()
    task = Task(
        workspace_id=workspace.id,
        conversation_id=conversation.id,
        title="Implement endpoint",
        description="Implement the requested endpoint and report the result.",
        assigned_agent_id=agent.id,
        status=TaskStatus.PENDING,
    )
    session.add(task)
    await session.commit()
    return agent, task


@pytest_asyncio.fixture
async def orchestrator_session(tmp_path):
    database_path = tmp_path / "tools-test.db"
    engine = create_async_engine(f"sqlite+aiosqlite:///{database_path.as_posix()}")
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with session_factory() as session:
        yield session
    await engine.dispose()


# ---------------------------------------------------------------------------
# M2: safe calculator
# ---------------------------------------------------------------------------


def test_safe_eval_expression_evaluates_basic_arithmetic() -> None:
    assert safe_eval_expression("1+2*3") == 7.0
    assert safe_eval_expression("(10 // 3) + 2 ** 3") == float(10 // 3 + 2**3)


def test_safe_eval_expression_rejects_injection() -> None:
    with pytest.raises(ValueError, match="unsupported expression"):
        safe_eval_expression("__import__('os').system('echo hi')")
    with pytest.raises(ValueError, match="unsupported expression"):
        safe_eval_expression("os.system('echo hi')")


def test_safe_eval_expression_rejects_non_numeric() -> None:
    with pytest.raises(ValueError, match="unsupported literal"):
        safe_eval_expression("'a' + 'b'")
    with pytest.raises(ValueError, match="unsupported expression"):
        safe_eval_expression("[1, 2, 3]")


# ---------------------------------------------------------------------------
# M1: chat_completion tools passthrough + tool_calls surfacing
# ---------------------------------------------------------------------------


def test_chat_completion_passes_tools_and_surfaces_tool_calls(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = _settings(deepseek_api_key="unit-test-deepseek-key")
    captured: dict = {}
    tools = get_tools_spec()

    async def fake_acompletion(**kwargs):
        captured.update(kwargs)
        return {
            "choices": [
                {
                    "message": {
                        "content": None,
                        "tool_calls": [
                            {
                                "id": "call_1",
                                "type": "function",
                                "function": {
                                    "name": "calculate",
                                    "arguments": '{"expression": "1+2*3"}',
                                },
                            }
                        ],
                    }
                }
            ],
            "usage": {"prompt_tokens": 4, "completion_tokens": 2},
        }

    monkeypatch.setattr(litellm_service, "get_settings", lambda: settings)
    monkeypatch.setattr(
        litellm_service, "_import_acompletion", lambda: fake_acompletion
    )
    litellm_service.clear_model_config_cache()

    result = asyncio.run(
        litellm_service.chat_completion(
            "code_model",
            [{"role": "user", "content": "ping"}],
            tools=tools,
        )
    )

    assert captured["tools"] == tools
    assert result.content == ""
    assert result.tool_calls == [
        {
            "id": "call_1",
            "name": "calculate",
            "arguments": '{"expression": "1+2*3"}',
        }
    ]


def test_chat_completion_without_tools_does_not_add_kwarg(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = _settings(deepseek_api_key="unit-test-deepseek-key")
    captured: dict = {}

    async def fake_acompletion(**kwargs):
        captured.update(kwargs)
        return {
            "choices": [{"message": {"content": "pong"}}],
            "usage": {"prompt_tokens": 4, "completion_tokens": 2},
        }

    monkeypatch.setattr(litellm_service, "get_settings", lambda: settings)
    monkeypatch.setattr(
        litellm_service, "_import_acompletion", lambda: fake_acompletion
    )
    litellm_service.clear_model_config_cache()

    result = asyncio.run(
        litellm_service.chat_completion(
            "code_model", [{"role": "user", "content": "ping"}]
        )
    )

    assert result.content == "pong"
    assert "tools" not in captured


def test_validate_request_accepts_content_none_for_tool_calls() -> None:
    # Assistant messages carrying tool_calls may have content=None; the guard
    # only requires the "content" KEY to be present, so None must pass.
    litellm_service._validate_request(
        [
            {"role": "system", "content": "sys"},
            {"role": "user", "content": "hello"},
            {
                "role": "assistant",
                "content": None,
                "tool_calls": [
                    {"id": "call_1", "name": "calculate", "arguments": "{}"}
                ],
            },
        ],
        0.7,
    )

    with pytest.raises(litellm_service.ModelConfigurationError):
        litellm_service._validate_request(
            [{"role": "assistant", "tool_calls": []}],
            0.7,
        )


# ---------------------------------------------------------------------------
# M2: execute_tool dispatch
# ---------------------------------------------------------------------------


def test_execute_tool_unknown_name_returns_error_string() -> None:
    result = asyncio.run(
        execute_tool("nope", "{}", session=None)
    )
    assert result == "Unknown tool: nope"


def test_execute_tool_invalid_arguments_returns_error_string() -> None:
    result = asyncio.run(
        execute_tool("calculate", "not-json", session=None)
    )
    assert result.startswith("Tool 'calculate' failed:")


# ---------------------------------------------------------------------------
# M3: orchestrator tool loop
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_task_tools_are_scoped_to_trusted_workspace(orchestrator_session) -> None:
    first_workspace = Workspace(name="First", description="first")
    second_workspace = Workspace(name="Second", description="second")
    orchestrator_session.add_all([first_workspace, second_workspace])
    await orchestrator_session.flush()
    orchestrator_session.add_all(
        [
            Task(
                workspace_id=first_workspace.id,
                title="Visible task",
                description="visible",
                status=TaskStatus.PENDING,
            ),
            Task(
                workspace_id=second_workspace.id,
                title="Hidden task",
                description="hidden",
                status=TaskStatus.PENDING,
            ),
        ]
    )
    await orchestrator_session.commit()

    result = await execute_tool(
        "query_tasks",
        f'{{"workspace_id": {second_workspace.id}}}',
        session=orchestrator_session,
        workspace_id=first_workspace.id,
    )
    assert "Visible task" in result
    assert "Hidden task" not in result


@pytest.mark.asyncio
async def test_tool_loop_calls_calculate_and_completes(orchestrator_session) -> None:
    agent, task = await create_task_graph(orchestrator_session)
    broadcaster = RecordingBroadcaster()
    tool_call = {
        "id": "call_1",
        "name": "calculate",
        "arguments": '{"expression": "1+2*3"}',
    }

    with patch(
        "app.core.orchestrator.litellm_service.chat_completion",
        new=AsyncMock(
            side_effect=[
                completion("", tool_calls=[tool_call]),
                completion("Endpoint implemented and verified."),
            ]
        ),
    ) as model_call:
        result = await AgentOrchestrator(
            orchestrator_session, broadcaster
        ).run_task(task.id)

    assert model_call.await_count == 2
    assert model_call.await_args_list[0].kwargs["tools"] == get_tools_spec()
    second_messages = model_call.await_args_list[1].args[1]
    assert second_messages[0] == {
        "role": "system",
        "content": "Return a concise implementation result.",
    }
    assert second_messages[1]["role"] == "system"
    assert "任务级上下文" in second_messages[1]["content"]
    assert second_messages[2]["role"] == "user"
    assert second_messages[2]["content"] == "Implement the requested endpoint and report the result."
    assert second_messages[3]["role"] == "assistant"
    assert second_messages[3]["content"] == ""
    assert second_messages[3]["tool_calls"] == [tool_call]
    assert second_messages[4] == {
        "role": "tool",
        "tool_call_id": "call_1",
        "content": "7.0",
    }

    assert result.status == TaskStatus.COMPLETED
    assert result.result == "Endpoint implemented and verified."

    tool_steps = list(
        await orchestrator_session.scalars(
            select(TaskStep)
            .where(TaskStep.task_id == task.id, TaskStep.step_name == "tool_call")
        )
    )
    assert len(tool_steps) == 1
    assert tool_steps[0].status == "completed"
    assert tool_steps[0].output == "7.0"

    main_step = await orchestrator_session.scalar(
        select(TaskStep).where(
            TaskStep.task_id == task.id,
            TaskStep.step_name == "call_agent_model",
        )
    )
    assert main_step is not None
    assert main_step.status == "completed"
    assert main_step.output == "Endpoint implemented and verified."


@pytest.mark.asyncio
async def test_tool_loop_continues_after_failing_handler(orchestrator_session) -> None:
    agent, task = await create_task_graph(orchestrator_session)
    broadcaster = RecordingBroadcaster()
    tool_call = {
        "id": "call_1",
        "name": "calculate",
        "arguments": '{"expression": "1/0"}',
    }

    with patch(
        "app.core.orchestrator.litellm_service.chat_completion",
        new=AsyncMock(
            side_effect=[
                completion("", tool_calls=[tool_call]),
                completion("Recovered after the failed calculation."),
            ]
        ),
    ) as model_call:
        result = await AgentOrchestrator(
            orchestrator_session, broadcaster
        ).run_task(task.id)

    assert model_call.await_count == 2
    assert result.status == TaskStatus.COMPLETED
    assert result.result == "Recovered after the failed calculation."

    tool_steps = list(
        await orchestrator_session.scalars(
            select(TaskStep)
            .where(TaskStep.task_id == task.id, TaskStep.step_name == "tool_call")
        )
    )
    assert len(tool_steps) == 1
    assert "Calculate failed" in (tool_steps[0].output or "")


@pytest.mark.asyncio
async def test_tool_loop_continues_after_unknown_tool(orchestrator_session) -> None:
    agent, task = await create_task_graph(orchestrator_session)
    broadcaster = RecordingBroadcaster()
    tool_call = {"id": "call_1", "name": "not_a_real_tool", "arguments": "{}"}

    with patch(
        "app.core.orchestrator.litellm_service.chat_completion",
        new=AsyncMock(
            side_effect=[
                completion("", tool_calls=[tool_call]),
                completion("Final answer after unknown tool."),
            ]
        ),
    ) as model_call:
        result = await AgentOrchestrator(
            orchestrator_session, broadcaster
        ).run_task(task.id)

    assert model_call.await_count == 2
    assert result.status == TaskStatus.COMPLETED
    assert result.result == "Final answer after unknown tool."

    tool_steps = list(
        await orchestrator_session.scalars(
            select(TaskStep)
            .where(TaskStep.task_id == task.id, TaskStep.step_name == "tool_call")
        )
    )
    assert len(tool_steps) == 1
    assert "Unknown tool: not_a_real_tool" in (tool_steps[0].output or "")


@pytest.mark.asyncio
async def test_tool_loop_terminates_when_model_always_returns_tool_calls(
    orchestrator_session,
) -> None:
    agent, task = await create_task_graph(orchestrator_session)
    broadcaster = RecordingBroadcaster()
    tool_call = {
        "id": "call_1",
        "name": "calculate",
        "arguments": '{"expression": "1+1"}',
    }

    def always_tool_calls(*_args, **_kwargs) -> ChatCompletionResult:
        return completion("", tool_calls=[tool_call])

    with patch(
        "app.core.orchestrator.litellm_service.chat_completion",
        new=AsyncMock(side_effect=always_tool_calls),
    ) as model_call:
        result = await AgentOrchestrator(
            orchestrator_session, broadcaster
        ).run_task(task.id)

    # 1 initial call + max_iterations=5 follow-up calls, then a hard failure.
    assert model_call.await_count == 6
    assert result.status == TaskStatus.FAILED
    assert "did not converge" in (result.result or "")

    tool_steps = list(
        await orchestrator_session.scalars(
            select(TaskStep)
            .where(TaskStep.task_id == task.id, TaskStep.step_name == "tool_call")
        )
    )
    assert len(tool_steps) == 5
    assert all(step.status == "completed" for step in tool_steps)
