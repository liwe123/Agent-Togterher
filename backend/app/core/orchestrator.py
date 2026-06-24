from __future__ import annotations

import logging
from collections.abc import Awaitable
from decimal import Decimal
from typing import Final

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents import final_agent, manager_agent, review_agent, worker_agent
from app.db.base import utc_now
from app.db.session import AsyncSessionLocal
from app.models import (
    Agent,
    Message,
    MessageType,
    ModelCall,
    SenderType,
    Task,
    TaskStatus,
    TaskStep,
)
from app.schemas import AgentStatusRead, MessageRead, TaskRead
from app.services import litellm_service
from app.services.litellm_service import ChatCompletionResult
from app.websocket import WebSocketManager, create_event, websocket_manager

logger = logging.getLogger(__name__)

MODEL_STEP_NAME: Final = "call_agent_model"
MANAGER_AGENT_NAME: Final = "项目总设计师"
REVIEW_AGENT_NAME: Final = "测试专员"
MANAGER_ROLE: Final = "project_architect"
REVIEW_ROLE: Final = "qa_engineer"
WORKER_ROLES: Final = {
    "前端设计师": "frontend_designer",
    "Agent工程师": "agent_engineer",
    "知识库管理员": "knowledge_manager",
    "运维": "operations_engineer",
}


class OrchestratorError(Exception):
    """Base error for requests that cannot be handed to the orchestrator."""


class TaskNotFoundError(OrchestratorError):
    """Raised when a task id does not exist."""


class TaskNotRunnableError(OrchestratorError):
    """Raised when a task cannot enter the running state."""


class AgentOrchestrator:
    """Execute one persisted task and publish its lifecycle events.

    The executor only needs a task id and a database session. A later queue
    worker can therefore call the same entry point without depending on the
    HTTP or MessageHub layers.
    """

    def __init__(
        self,
        session: AsyncSession,
        broadcaster: WebSocketManager = websocket_manager,
    ) -> None:
        self._session = session
        self._broadcaster = broadcaster

    async def run_task(self, task_id: int) -> TaskRead:
        task = await self._session.get(Task, task_id)
        if task is None:
            raise TaskNotFoundError(f"Task {task_id} not found")
        if task.status != TaskStatus.PENDING:
            raise TaskNotRunnableError(
                f"Task {task_id} is {task.status.value} and cannot be started"
            )

        agent = (
            await self._session.get(Agent, task.assigned_agent_id)
            if task.assigned_agent_id is not None
            else None
        )

        if agent is not None and self._is_manager(agent):
            return await self._run_multi_agent_task(task, agent)
        return await self._run_single_agent_task(task, agent)

    async def _run_single_agent_task(
        self,
        task: Task,
        agent: Agent | None,
    ) -> TaskRead:
        step: TaskStep | None = None

        try:
            if agent is None:
                raise TaskNotRunnableError(
                    f"Task {task.id} does not have an available assigned agent"
                )
            if task.conversation_id is None:
                raise TaskNotRunnableError(
                    f"Task {task.id} is not attached to a conversation"
                )

            await self.update_agent_status(agent, "running")
            await self.update_task_status(task, TaskStatus.RUNNING)
            step = await self.save_task_step(
                task,
                agent,
                status="running",
                input_text=task.description,
            )

            try:
                completion = await self.call_agent_model(task, agent)
            except Exception as exc:
                await self.save_model_call(task, agent, error=exc)
                raise

            await self.save_model_call(task, agent, completion=completion)
            await self.save_task_step(
                task,
                agent,
                step=step,
                status="completed",
                output=completion.content,
            )
            await self.update_task_status(
                task,
                TaskStatus.COMPLETED,
                result=completion.content,
            )
            await self.update_agent_status(agent, "idle")
            await self.send_result_message(task, agent, completion.content)
            return TaskRead.model_validate(task)
        except Exception as exc:
            error_message = self._error_message(exc)
            logger.warning(
                "Task execution failed",
                extra={"task_id": task.id, "agent_id": getattr(agent, "id", None)},
                exc_info=True,
            )
            await self._mark_failed(task, agent, step, error_message)
            return TaskRead.model_validate(task)

    async def _run_multi_agent_task(self, task: Task, manager: Agent) -> TaskRead:
        """Run Manager -> Worker(s) -> Review -> Final for a manager task."""
        active_agent: Agent | None = manager
        step: TaskStep | None = None
        step_name = "manager_plan"

        try:
            if task.conversation_id is None:
                raise TaskNotRunnableError(
                    f"Task {task.id} is not attached to a conversation"
                )

            workspace_agents = list(
                await self._session.scalars(
                    select(Agent)
                    .where(Agent.workspace_id == task.workspace_id)
                    .order_by(Agent.id)
                )
            )

            await self.update_agent_status(manager, "running")
            await self.update_task_status(task, TaskStatus.RUNNING)
            step = await self.save_task_step(
                task,
                manager,
                step_name=step_name,
                status="running",
                input_text=task.description,
            )
            manager_completion = await self._call_and_log(
                task,
                manager,
                manager_agent.generate_plan(
                    manager,
                    task.description,
                    [agent.name for agent in workspace_agents],
                ),
            )
            plan = manager_agent.parse_manager_plan(manager_completion.content)
            plan_json = manager_agent.serialize_manager_plan(plan)
            await self.save_task_step(
                task,
                manager,
                step=step,
                status="completed",
                output=plan_json,
            )
            await self.send_result_message(
                task,
                manager,
                f"【任务拆解】\n{plan_json}",
            )
            await self.update_agent_status(manager, "idle")

            worker_results: list[dict[str, object]] = []
            for subtask in plan.subtasks:
                step = None
                step_name = f"worker_execute_{subtask.id}"
                active_agent = self._find_agent(
                    workspace_agents,
                    name=worker_agent.worker_name_for_task_type(subtask.task_type),
                    role=WORKER_ROLES[subtask.agent],
                )
                if active_agent is None:
                    raise TaskNotRunnableError(
                        f'Required worker agent "{subtask.agent}" is not configured '
                        f"in workspace {task.workspace_id}"
                    )

                await self.update_agent_status(active_agent, "running")
                step = await self.save_task_step(
                    task,
                    active_agent,
                    step_name=step_name,
                    status="running",
                    input_text=subtask.model_dump_json(indent=2),
                )
                worker_completion = await self._call_and_log(
                    task,
                    active_agent,
                    worker_agent.execute_subtask(
                        active_agent,
                        task.description,
                        plan,
                        subtask,
                    ),
                )
                result = {
                    "id": subtask.id,
                    "title": subtask.title,
                    "task_type": subtask.task_type,
                    "agent": active_agent.name,
                    "result": worker_completion.content,
                }
                worker_results.append(result)
                await self.save_task_step(
                    task,
                    active_agent,
                    step=step,
                    status="completed",
                    output=worker_completion.content,
                )
                await self.send_result_message(
                    task,
                    active_agent,
                    (
                        f"【Agent 执行结果 {subtask.id}/{len(plan.subtasks)}】\n"
                        f"{worker_completion.content}"
                    ),
                )
                await self.update_agent_status(active_agent, "idle")

            step = None
            step_name = "review_results"
            active_agent = self._find_agent(
                workspace_agents,
                name=REVIEW_AGENT_NAME,
                role=REVIEW_ROLE,
            )
            if active_agent is None:
                raise TaskNotRunnableError(
                    f'Required review agent "{REVIEW_AGENT_NAME}" is not configured '
                    f"in workspace {task.workspace_id}"
                )

            await self.update_agent_status(active_agent, "running")
            step = await self.save_task_step(
                task,
                active_agent,
                step_name=step_name,
                status="running",
                input_text=str(worker_results),
            )
            review_completion = await self._call_and_log(
                task,
                active_agent,
                review_agent.review_results(
                    active_agent,
                    task.description,
                    plan,
                    worker_results,
                ),
            )
            await self.save_task_step(
                task,
                active_agent,
                step=step,
                status="completed",
                output=review_completion.content,
            )
            await self.send_result_message(
                task,
                active_agent,
                f"【测试专员审核】\n{review_completion.content}",
            )
            await self.update_agent_status(active_agent, "idle")

            step = None
            step_name = "final_summary"
            active_agent = manager
            await self.update_agent_status(manager, "running")
            step = await self.save_task_step(
                task,
                manager,
                step_name=step_name,
                status="running",
                input_text=review_completion.content,
            )
            final_completion = await self._call_and_log(
                task,
                manager,
                final_agent.build_final_result(
                    manager,
                    task.description,
                    plan,
                    worker_results,
                    review_completion.content,
                ),
            )
            await self.save_task_step(
                task,
                manager,
                step=step,
                status="completed",
                output=final_completion.content,
            )
            await self.update_task_status(
                task,
                TaskStatus.COMPLETED,
                result=final_completion.content,
            )
            await self.update_agent_status(manager, "idle")
            await self.send_result_message(
                task,
                manager,
                f"【最终汇总】\n{final_completion.content}",
            )
            return TaskRead.model_validate(task)
        except Exception as exc:
            error_message = self._error_message(exc)
            logger.warning(
                "Multi-Agent task execution failed",
                extra={
                    "task_id": task.id,
                    "agent_id": getattr(active_agent, "id", None),
                    "step_name": step_name,
                },
                exc_info=True,
            )
            await self._mark_failed(
                task,
                active_agent,
                step,
                error_message,
                step_name=step_name,
            )
            return TaskRead.model_validate(task)

    async def _call_and_log(
        self,
        task: Task,
        agent: Agent,
        call: Awaitable[ChatCompletionResult],
    ) -> ChatCompletionResult:
        try:
            completion = await call
        except Exception as exc:
            await self.save_model_call(task, agent, error=exc)
            raise
        await self.save_model_call(task, agent, completion=completion)
        return completion

    async def update_task_status(
        self,
        task: Task,
        status: TaskStatus,
        *,
        result: str | None = None,
    ) -> TaskRead:
        task.status = status
        if result is not None:
            task.result = result
        await self._session.commit()
        await self._session.refresh(task)
        task_data = TaskRead.model_validate(task)
        await self._broadcaster.broadcast_to_workspace(
            task.workspace_id,
            create_event("task.status_changed", task_data),
        )
        return task_data

    async def update_agent_status(
        self,
        agent: Agent,
        status: str,
    ) -> AgentStatusRead:
        agent.status = status
        agent.last_active_at = utc_now()
        await self._session.commit()
        await self._session.refresh(agent)
        status_data = AgentStatusRead(
            id=agent.id,
            status=agent.status,
            last_active_at=agent.last_active_at,
        )
        await self._broadcaster.broadcast_to_workspace(
            agent.workspace_id,
            create_event("agent.status_changed", status_data),
        )
        return status_data

    async def call_agent_model(
        self,
        task: Task,
        agent: Agent,
    ) -> ChatCompletionResult:
        return await litellm_service.chat_completion(
            agent.model_name,
            [
                {"role": "system", "content": agent.system_prompt},
                {"role": "user", "content": task.description},
            ],
        )

    async def save_task_step(
        self,
        task: Task,
        agent: Agent | None,
        *,
        status: str,
        step_name: str = MODEL_STEP_NAME,
        input_text: str | None = None,
        output: str | None = None,
        step: TaskStep | None = None,
    ) -> TaskStep:
        now = utc_now()
        if step is None:
            step = TaskStep(
                task_id=task.id,
                agent_id=agent.id if agent is not None else None,
                step_name=step_name,
                input=input_text,
                output=output,
                status=status,
                started_at=now,
            )
            self._session.add(step)
        else:
            step.status = status
            if input_text is not None:
                step.input = input_text
            if output is not None:
                step.output = output

        if status in {"completed", "failed"}:
            step.finished_at = now
        await self._session.commit()
        await self._session.refresh(step)
        await self._broadcaster.broadcast_to_workspace(
            task.workspace_id,
            create_event(
                "task.step_changed",
                {
                    "id": step.id,
                    "task_id": step.task_id,
                    "agent_id": step.agent_id,
                    "step_name": step.step_name,
                    "input": step.input,
                    "output": step.output,
                    "status": step.status,
                    "started_at": step.started_at,
                    "finished_at": step.finished_at,
                },
            ),
        )
        return step

    async def save_model_call(
        self,
        task: Task,
        agent: Agent,
        *,
        completion: ChatCompletionResult | None = None,
        error: Exception | None = None,
    ) -> ModelCall:
        if (completion is None) == (error is None):
            raise ValueError("Provide exactly one of completion or error")

        if completion is not None:
            model_name = completion.model_name
            provider = completion.provider
            prompt_tokens = completion.usage.prompt_tokens
            completion_tokens = completion.usage.completion_tokens
            latency_ms = completion.latency_ms
            call_status = "completed"
            error_message = None
        else:
            model_name, provider, latency_ms = self._failed_call_details(agent, error)
            prompt_tokens = 0
            completion_tokens = 0
            call_status = "failed"
            error_message = self._error_message(error)

        model_call = ModelCall(
            task_id=task.id,
            agent_id=agent.id,
            model_name=model_name,
            provider=provider,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            cost=Decimal("0"),
            latency_ms=latency_ms,
            status=call_status,
            error_message=error_message,
        )
        self._session.add(model_call)
        await self._session.commit()
        await self._session.refresh(model_call)
        await self._broadcaster.broadcast_to_workspace(
            task.workspace_id,
            create_event(
                "model.call_finished",
                {
                    "id": model_call.id,
                    "task_id": task.id,
                    "agent_id": agent.id,
                    "model_name": model_call.model_name,
                    "provider": model_call.provider,
                    "prompt_tokens": model_call.prompt_tokens,
                    "completion_tokens": model_call.completion_tokens,
                    "latency_ms": model_call.latency_ms,
                    "status": model_call.status,
                    "error_message": model_call.error_message,
                },
            ),
        )
        return model_call

    async def send_result_message(
        self,
        task: Task,
        agent: Agent | None,
        content: str,
        *,
        is_error: bool = False,
    ) -> MessageRead:
        if task.conversation_id is None:
            raise TaskNotRunnableError(
                f"Task {task.id} is not attached to a conversation"
            )
        message = Message(
            conversation_id=task.conversation_id,
            sender_type=SenderType.AGENT if agent is not None else SenderType.SYSTEM,
            sender_id=agent.id if agent is not None else None,
            content=content,
            message_type=MessageType.ERROR if is_error else MessageType.NORMAL,
        )
        self._session.add(message)
        await self._session.commit()
        await self._session.refresh(message)
        message_data = MessageRead.model_validate(message)
        await self._broadcaster.broadcast_to_workspace(
            task.workspace_id,
            create_event("message.created", message_data),
        )
        return message_data

    async def _mark_failed(
        self,
        task: Task,
        agent: Agent | None,
        step: TaskStep | None,
        error_message: str,
        *,
        step_name: str = MODEL_STEP_NAME,
    ) -> None:
        try:
            if step is None:
                step = await self.save_task_step(
                    task,
                    agent,
                    step_name=step_name,
                    status="failed",
                    input_text=task.description,
                    output=error_message,
                )
            else:
                await self.save_task_step(
                    task,
                    agent,
                    step=step,
                    status="failed",
                    output=error_message,
                )
            await self.update_task_status(
                task,
                TaskStatus.FAILED,
                result=error_message,
            )
            if agent is not None:
                await self.update_agent_status(agent, "failed")
            if task.conversation_id is not None:
                await self.send_result_message(
                    task,
                    agent,
                    f"Task failed: {error_message}",
                    is_error=True,
                )
            await self._broadcaster.broadcast_to_workspace(
                task.workspace_id,
                create_event(
                    "error",
                    {"task_id": task.id, "message": error_message},
                ),
            )
        except Exception:
            logger.exception(
                "Failed to persist complete task failure state",
                extra={"task_id": task.id},
            )
            await self._session.rollback()

    @staticmethod
    def _is_manager(agent: Agent) -> bool:
        return agent.name == MANAGER_AGENT_NAME or agent.role == MANAGER_ROLE

    @staticmethod
    def _find_agent(
        agents: list[Agent],
        *,
        name: str,
        role: str,
    ) -> Agent | None:
        return next((agent for agent in agents if agent.name == name), None) or next(
            (agent for agent in agents if agent.role == role), None
        )

    @staticmethod
    def _failed_call_details(
        agent: Agent,
        error: Exception | None,
    ) -> tuple[str, str, int | None]:
        if isinstance(error, litellm_service.ModelCallError) and error.attempts:
            attempt = error.attempts[-1]
            return attempt.model_name, attempt.provider, error.latency_ms
        provider = (
            agent.model_name.split("/", maxsplit=1)[0]
            if "/" in agent.model_name
            else "unknown"
        )
        latency_ms = getattr(error, "latency_ms", None)
        return agent.model_name, provider, latency_ms

    @staticmethod
    def _error_message(error: BaseException | None) -> str:
        if error is None:
            return "Unknown task execution error"
        message = str(error).strip() or error.__class__.__name__
        return message[:4000]


async def run_task(task_id: int) -> TaskRead:
    """Execute a task by id using the application session factory.

    This small, queue-friendly entry point is suitable for an inline caller
    today and for a Redis worker in a later phase.
    """
    async with AsyncSessionLocal() as session:
        return await AgentOrchestrator(session).run_task(task_id)


async def update_task_status(
    session: AsyncSession,
    task: Task,
    status: TaskStatus,
    *,
    result: str | None = None,
    broadcaster: WebSocketManager = websocket_manager,
) -> TaskRead:
    """Public persistence helper for alternate orchestrator/worker implementations."""
    return await AgentOrchestrator(session, broadcaster).update_task_status(
        task,
        status,
        result=result,
    )


async def update_agent_status(
    session: AsyncSession,
    agent: Agent,
    status: str,
    *,
    broadcaster: WebSocketManager = websocket_manager,
) -> AgentStatusRead:
    return await AgentOrchestrator(session, broadcaster).update_agent_status(
        agent,
        status,
    )


async def call_agent_model(task: Task, agent: Agent) -> ChatCompletionResult:
    """Call the configured Agent model without coupling the caller to HTTP."""
    return await litellm_service.chat_completion(
        agent.model_name,
        [
            {"role": "system", "content": agent.system_prompt},
            {"role": "user", "content": task.description},
        ],
    )


async def save_task_step(
    session: AsyncSession,
    task: Task,
    agent: Agent | None,
    *,
    status: str,
    step_name: str = MODEL_STEP_NAME,
    input_text: str | None = None,
    output: str | None = None,
    step: TaskStep | None = None,
    broadcaster: WebSocketManager = websocket_manager,
) -> TaskStep:
    return await AgentOrchestrator(session, broadcaster).save_task_step(
        task,
        agent,
        status=status,
        step_name=step_name,
        input_text=input_text,
        output=output,
        step=step,
    )


async def save_model_call(
    session: AsyncSession,
    task: Task,
    agent: Agent,
    *,
    completion: ChatCompletionResult | None = None,
    error: Exception | None = None,
    broadcaster: WebSocketManager = websocket_manager,
) -> ModelCall:
    return await AgentOrchestrator(session, broadcaster).save_model_call(
        task,
        agent,
        completion=completion,
        error=error,
    )


async def send_result_message(
    session: AsyncSession,
    task: Task,
    agent: Agent | None,
    content: str,
    *,
    is_error: bool = False,
    broadcaster: WebSocketManager = websocket_manager,
) -> MessageRead:
    return await AgentOrchestrator(session, broadcaster).send_result_message(
        task,
        agent,
        content,
        is_error=is_error,
    )


__all__ = [
    "AgentOrchestrator",
    "OrchestratorError",
    "TaskNotFoundError",
    "TaskNotRunnableError",
    "call_agent_model",
    "run_task",
    "save_model_call",
    "save_task_step",
    "send_result_message",
    "update_agent_status",
    "update_task_status",
]
