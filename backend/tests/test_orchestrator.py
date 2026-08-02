from decimal import Decimal
from unittest.mock import AsyncMock, patch

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.orchestrator import AgentOrchestrator, TaskNotRunnableError
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


async def create_task_graph(session) -> tuple[Agent, Task]:
    workspace = Workspace(name="Orchestrator workspace", description="tests")
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
    database_path = tmp_path / "orchestrator-test.db"
    engine = create_async_engine(f"sqlite+aiosqlite:///{database_path.as_posix()}")
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with session_factory() as session:
        yield session
    await engine.dispose()


@pytest_asyncio.fixture
async def orchestrator_session_factory(tmp_path):
    database_path = tmp_path / "orchestrator-fallback-test.db"
    engine = create_async_engine(f"sqlite+aiosqlite:///{database_path.as_posix()}")
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    try:
        yield session_factory
    finally:
        await engine.dispose()


class BrokenFailureModelCallOrchestrator(AgentOrchestrator):
    async def save_model_call(
        self,
        task: Task,
        agent: Agent,
        *,
        completion: ChatCompletionResult | None = None,
        error: Exception | None = None,
    ) -> ModelCall:
        if error is not None:
            self._session.add(
                ModelCall(
                    task_id=task.id,
                    agent_id=agent.id,
                    provider="broken",
                    prompt_tokens=0,
                    completion_tokens=0,
                    cost=Decimal("0"),
                    status="failed",
                )
            )
            await self._session.flush()
        return await super().save_model_call(
            task,
            agent,
            completion=completion,
            error=error,
        )


@pytest.mark.asyncio
async def test_run_task_completes_and_persists_result(orchestrator_session) -> None:
    agent, task = await create_task_graph(orchestrator_session)
    broadcaster = RecordingBroadcaster()
    completion = ChatCompletionResult(
        content="Endpoint implemented and verified.",
        usage=TokenUsage(prompt_tokens=21, completion_tokens=7, total_tokens=28),
        provider="deepseek",
        model_name="deepseek/deepseek-chat",
        requested_model="code_model",
        latency_ms=42,
        fallback_used=False,
    )

    with patch(
        "app.core.orchestrator.litellm_service.chat_completion",
        new=AsyncMock(return_value=completion),
    ) as model_call:
        result = await AgentOrchestrator(
            orchestrator_session, broadcaster
        ).run_task(task.id)

    model_call.assert_awaited_once_with(
        "code_model",
        [
            {
                "role": "system",
                "content": "Return a concise implementation result.",
            },
            {
                "role": "user",
                "content": "Implement the requested endpoint and report the result.",
            },
        ],
        api_keys={},
        custom_models={},
    )
    await orchestrator_session.refresh(agent)
    step = await orchestrator_session.scalar(
        select(TaskStep).where(TaskStep.task_id == task.id)
    )
    saved_call = await orchestrator_session.scalar(
        select(ModelCall).where(ModelCall.task_id == task.id)
    )
    message = await orchestrator_session.scalar(
        select(Message).where(Message.conversation_id == task.conversation_id)
    )

    assert result.status == TaskStatus.COMPLETED
    assert result.result == completion.content
    assert agent.status == "idle"
    assert agent.last_active_at is not None
    assert step is not None
    assert step.status == "completed"
    assert step.input == task.description
    assert step.output == completion.content
    assert step.started_at is not None
    assert step.finished_at is not None
    assert saved_call is not None
    assert saved_call.model_name == completion.model_name
    assert saved_call.provider == completion.provider
    assert saved_call.prompt_tokens == 21
    assert saved_call.completion_tokens == 7
    assert saved_call.status == "completed"
    assert saved_call.error_message is None
    assert message is not None
    assert message.sender_id == agent.id
    assert message.content == completion.content
    assert message.message_type == MessageType.NORMAL
    assert [event[1]["type"] for event in broadcaster.events] == [
        "task.status_changed",
        "agent.status_changed",
        "task.step_changed",
        "model.call_finished",
        "task.step_changed",
        "task.status_changed",
        "agent.status_changed",
        "message.created",
    ]
    assert broadcaster.events[0][1]["payload"]["status"] == "running"
    assert broadcaster.events[1][1]["payload"]["status"] == "running"
    assert broadcaster.events[5][1]["payload"]["status"] == "completed"
    assert broadcaster.events[6][1]["payload"]["status"] == "idle"


@pytest.mark.asyncio
async def test_run_task_failure_is_persisted_and_reported(orchestrator_session) -> None:
    agent, task = await create_task_graph(orchestrator_session)
    broadcaster = RecordingBroadcaster()
    error = ModelCallError(
        "code_model",
        [
            ModelAttemptFailure(
                provider="deepseek",
                model_name="deepseek/deepseek-chat",
                message="provider timeout",
                latency_ms=73,
            )
        ],
    )

    with patch(
        "app.core.orchestrator.litellm_service.chat_completion",
        new=AsyncMock(side_effect=error),
    ):
        result = await AgentOrchestrator(
            orchestrator_session, broadcaster
        ).run_task(task.id)

    await orchestrator_session.refresh(agent)
    step = await orchestrator_session.scalar(
        select(TaskStep).where(TaskStep.task_id == task.id)
    )
    saved_call = await orchestrator_session.scalar(
        select(ModelCall).where(ModelCall.task_id == task.id)
    )
    message = await orchestrator_session.scalar(
        select(Message).where(Message.conversation_id == task.conversation_id)
    )

    assert result.status == TaskStatus.FAILED
    assert "provider timeout" in (result.result or "")
    assert agent.status == "failed"
    assert step is not None
    assert step.status == "failed"
    assert "provider timeout" in (step.output or "")
    assert step.finished_at is not None
    assert saved_call is not None
    assert saved_call.status == "failed"
    assert saved_call.model_name == "deepseek/deepseek-chat"
    assert saved_call.provider == "deepseek"
    assert saved_call.latency_ms == 73
    assert "provider timeout" in (saved_call.error_message or "")
    assert message is not None
    assert message.sender_id == agent.id
    assert message.message_type == MessageType.ERROR
    assert "Task failed" in message.content
    assert [event[1]["type"] for event in broadcaster.events] == [
        "task.status_changed",
        "agent.status_changed",
        "task.step_changed",
        "model.call_finished",
        "task.step_changed",
        "task.status_changed",
        "agent.status_changed",
        "message.created",
        "error",
    ]
    assert broadcaster.events[3][1]["payload"]["status"] == "failed"
    assert broadcaster.events[4][1]["payload"]["status"] == "failed"
    assert broadcaster.events[5][1]["payload"]["status"] == "failed"
    assert broadcaster.events[6][1]["payload"]["status"] == "failed"


@pytest.mark.asyncio
async def test_run_task_failure_uses_fallback_session_when_active_session_is_invalid(
    orchestrator_session_factory,
) -> None:
    async with orchestrator_session_factory() as session:
        agent, task = await create_task_graph(session)
        task_id = task.id
        agent_id = agent.id

        with patch(
            "app.core.orchestrator.litellm_service.chat_completion",
            new=AsyncMock(
                side_effect=ModelCallError(
                    "code_model",
                    [
                        ModelAttemptFailure(
                            provider="deepseek",
                            model_name="deepseek/deepseek-chat",
                            message="provider timeout",
                        )
                    ],
                )
            ),
        ):
            result = await BrokenFailureModelCallOrchestrator(
                session,
                RecordingBroadcaster(),
                failure_session_factory=orchestrator_session_factory,
            ).run_task(task_id)

    async with orchestrator_session_factory() as verification_session:
        saved_task = await verification_session.get(Task, task_id)
        saved_agent = await verification_session.get(Agent, agent_id)
        failed_step = await verification_session.scalar(
            select(TaskStep).where(TaskStep.task_id == task_id)
        )
        error_message = saved_task.result or ""

    assert result.status == TaskStatus.FAILED
    assert saved_task is not None
    assert saved_task.status == TaskStatus.FAILED
    assert saved_agent is not None
    assert saved_agent.status == "failed"
    assert failed_step is not None
    assert failed_step.status == "failed"
    assert "model_calls.model_name" in error_message


@pytest.mark.asyncio
async def test_run_task_rejects_non_pending_task_before_model_call(
    orchestrator_session,
) -> None:
    _, task = await create_task_graph(orchestrator_session)
    task.status = TaskStatus.RUNNING
    await orchestrator_session.commit()

    with patch(
        "app.core.orchestrator.litellm_service.chat_completion",
        new=AsyncMock(),
    ) as model_call:
        with pytest.raises(TaskNotRunnableError):
            await AgentOrchestrator(orchestrator_session, RecordingBroadcaster()).run_task(
                task.id
            )

    model_call.assert_not_awaited()
