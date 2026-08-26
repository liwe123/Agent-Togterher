import asyncio
import logging
import re
from collections import defaultdict
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.errors import AppError
from app.api.persistence import commit_or_conflict
from app.core.config import get_settings
from app.db.base import utc_now
from app.db.session import AsyncSessionLocal
from app.models import (
    Agent,
    Conversation,
    IntegrationNode,
    Message,
    MessageType,
    SenderType,
    Task,
    TaskStatus,
)
from app.schemas import AgentRead, MessageCreate, MessageRead, TaskRead
from app.services.quota_service import check_workspace_quota
from app.services.task_service import TaskService
from app.websocket import WebSocketManager, create_event, websocket_manager

logger = logging.getLogger(__name__)

DEFAULT_AGENT_NAME = "项目总设计师"
_MENTION_PATTERN = re.compile(r"[@＠]([\w-]+)")
MAX_RUNNING_TASKS_PER_WORKSPACE = 3
TaskDispatcher = Callable[[int], None]


def _log_background_result(background_task: asyncio.Task[Any]) -> None:
    try:
        background_task.result()
    except Exception:
        logger.exception("Background task execution failed")


def dispatch_background_task(task_id: int) -> None:
    """Schedule task execution and make unexpected dispatcher errors observable."""
    from app.core.orchestrator import run_task

    background_task = asyncio.create_task(run_task(task_id))
    background_task.add_done_callback(_log_background_result)


async def _run_node_dispatch(task_id: int, node_id: int, package: Any = None) -> None:
    """Execute a task on an integration node in an isolated session.

    Mirrors ``dispatch_background_task`` -> ``run_task``: the caller returns
    immediately while this coroutine opens its own ``AsyncSessionLocal`` so the
    integration dispatch never shares the request session.
    """
    from app.models.integration_node import IntegrationNode
    from app.services.integration_service import dispatch_task_to_node

    try:
        async with AsyncSessionLocal() as session:
            task = await session.get(Task, task_id)
            node = await session.get(IntegrationNode, node_id)
            if task is None or node is None:
                logger.warning(
                    "Skipping integration node dispatch: task=%s node=%s not found",
                    task_id,
                    node_id,
                )
                return
            await dispatch_task_to_node(session, task, node, package=package)
    except Exception:
        logger.exception(
            "Integration node dispatch failed for task=%s node=%s",
            task_id,
            node_id,
        )


_scheduled_node_dispatches: set[asyncio.Task[Any]] = set()


def schedule_node_dispatch(task_id: int, node_id: int, package: Any = None) -> None:
    """Fire-and-forget background dispatch; keeps a strong reference to the task."""
    background_task = asyncio.create_task(_run_node_dispatch(task_id, node_id, package))
    _scheduled_node_dispatches.add(background_task)
    background_task.add_done_callback(_scheduled_node_dispatches.discard)
    background_task.add_done_callback(_log_background_result)


async def recover_unfinished_tasks(
    session: AsyncSession,
    dispatcher: TaskDispatcher | None = None,
) -> int:
    """Dispatch tasks left unfinished by a previous in-process worker."""
    task_dispatcher = dispatcher or dispatch_background_task
    now = utc_now()
    tasks = list(
        await session.scalars(
            select(Task)
            .where(
                Task.status == TaskStatus.PENDING,
            )
            .order_by(Task.id)
        )
    )
    expired_running_tasks = list(
        await session.scalars(
            select(Task)
            .where(
                Task.status == TaskStatus.RUNNING,
                or_(
                    Task.execution_token_expires_at.is_(None),
                    Task.execution_token_expires_at < now,
                ),
            )
            .order_by(Task.id)
        )
    )
    tasks.extend(expired_running_tasks)
    if not tasks:
        return 0

    for task in expired_running_tasks:
        task.status = TaskStatus.PENDING
        task.execution_token = None
        task.execution_token_expires_at = None

    await commit_or_conflict(session)

    running_result = await session.execute(
        select(Task.workspace_id, func.count(Task.id))
        .where(Task.status == TaskStatus.RUNNING)
        .group_by(Task.workspace_id)
    )
    running_by_workspace = dict(running_result.all())
    dispatched_by_workspace: dict[int, int] = defaultdict(int)
    dispatched = 0
    for task in tasks:
        available = MAX_RUNNING_TASKS_PER_WORKSPACE - running_by_workspace.get(
            task.workspace_id, 0
        )
        if dispatched_by_workspace[task.workspace_id] >= available:
            continue
        task_dispatcher(task.id)
        dispatched_by_workspace[task.workspace_id] += 1
        dispatched += 1
    return dispatched


def parse_mentions(content: str) -> list[str]:
    """Return unique @mention names in their first-occurrence order."""
    mentions: list[str] = []
    seen: set[str] = set()
    for match in _MENTION_PATTERN.finditer(content):
        name = match.group(1)
        if name not in seen:
            seen.add(name)
            mentions.append(name)
    return mentions


@dataclass(frozen=True)
class MessageHubResult:
    message: MessageRead
    task: TaskRead
    assigned_agent: AgentRead | None


class MessageHub:
    """Persist incoming chat messages and dispatch user work to agents."""

    def __init__(
        self,
        session: AsyncSession,
        broadcaster: WebSocketManager = websocket_manager,
        dispatcher: TaskDispatcher | None = None,
    ) -> None:
        self._session = session
        self._broadcaster = broadcaster
        self._dispatcher = dispatcher or dispatch_background_task

    async def receive_user_message(
        self, conversation_id: int, content: str
    ) -> MessageHubResult:
        content = content.strip()
        if not content:
            raise AppError(422, "Message content cannot be empty")

        conversation = await self._get_conversation(conversation_id)
        await self._enforce_quota(conversation.workspace_id)
        active_count = await self._session.scalar(
            select(func.count(Task.id)).where(
                Task.workspace_id == conversation.workspace_id,
                Task.status.in_([TaskStatus.PENDING, TaskStatus.RUNNING]),
            )
        )
        if active_count is not None and active_count >= MAX_RUNNING_TASKS_PER_WORKSPACE:
            raise AppError(
                429,
                f"Workspace has {active_count} active tasks (max {MAX_RUNNING_TASKS_PER_WORKSPACE}). Please wait for some to complete.",
            )
        agents = list(
            await self._session.scalars(
                select(Agent)
                .where(Agent.workspace_id == conversation.workspace_id)
                .order_by(Agent.id)
            )
        )

        # Route @mentions to integration nodes (e.g. "@Cursor") when no internal
        # agent matches the mention name. This dispatches the task to a connected
        # external node instead of the internal LLM orchestrator.
        matched_node = await self._match_integration_node(content, agents, conversation)
        if matched_node is not None:
            return await self._create_node_task(conversation, content, matched_node)

        assigned_agent = self._select_agent(content, agents)

        message = Message(
            conversation_id=conversation.id,
            sender_type=SenderType.USER,
            sender_id=None,
            content=content,
            message_type=MessageType.NORMAL,
        )
        self._session.add(message)
        await self._session.flush()

        task = Task(
            workspace_id=conversation.workspace_id,
            conversation_id=conversation.id,
            title=content[:255],
            description=content,
            assigned_agent_id=assigned_agent.id,
            status=TaskStatus.PENDING,
            priority="normal",
            input_message_id=message.id,
        )
        self._session.add(task)
        await commit_or_conflict(self._session)
        await self._session.refresh(message)
        await self._session.refresh(task)
        await TaskService(self._session).enqueue(task)

        result = MessageHubResult(
            message=MessageRead.model_validate(message),
            task=TaskRead.model_validate(task),
            assigned_agent=AgentRead.model_validate(assigned_agent),
        )
        await self._broadcaster.broadcast_to_workspace(
            conversation.workspace_id,
            create_event("message.created", result.message),
        )
        await self._broadcaster.broadcast_to_workspace(
            conversation.workspace_id,
            create_event("task.status_changed", result.task),
        )
        if get_settings().task_execution_mode == "inline":
            self._dispatcher(task.id)
        return result

    async def receive_message(
        self, conversation_id: int, payload: MessageCreate
    ) -> MessageHubResult:
        """Accept public user messages; agent/system messages are internal only."""
        if payload.sender_type != SenderType.USER:
            raise AppError(403, "Only user messages can be created through this endpoint")
        if payload.sender_id is not None:
            raise AppError(422, "sender_id is not allowed for user messages")
        if payload.message_type != MessageType.NORMAL:
            raise AppError(422, "message_type must be normal for user messages")
        return await self.receive_user_message(conversation_id, payload.content)

    async def _enforce_quota(self, workspace_id: int) -> None:
        """在创建任务前校验工作区配额，超额硬熔断或触发限流时拒绝派发。

        软限制（未开启硬熔断或未超额）仅记录日志、放行，保持既有软性语义。
        """
        result = await check_workspace_quota(self._session, workspace_id)
        if result.blocked:
            reason = result.block_reason or "Workspace quota exceeded"
            await self._broadcaster.broadcast_to_workspace(
                workspace_id,
                create_event("error", {"message": reason}),
            )
            raise AppError(429, reason)
        if result.is_exceeded:
            logger.warning(
                "Workspace %s quota exceeded but hard limit disabled; allowing dispatch",
                workspace_id,
            )

    async def _match_integration_node(
        self, content: str, agents: list[Agent], conversation: Conversation
    ) -> IntegrationNode | None:
        """Return the integration node whose ``name`` exactly matches the first
        @mention that is not already an internal agent name."""
        agents_by_name = {agent.name: agent for agent in agents}
        nodes = list(
            await self._session.scalars(
                select(IntegrationNode).where(
                    IntegrationNode.workspace_id == conversation.workspace_id
                )
            )
        )
        nodes_by_name = {node.name: node for node in nodes}
        for name in parse_mentions(content):
            if name in agents_by_name:
                # An internal agent takes priority over an integration node.
                continue
            node = nodes_by_name.get(name)
            if node is not None:
                return node
        return None

    async def _create_node_task(
        self,
        conversation: Conversation,
        content: str,
        node: IntegrationNode,
    ) -> MessageHubResult:
        """Persist a user message and dispatch it to an integration node.

        The task is created with ``assigned_agent_id=None`` and executed by the
        bridge layer (not the internal orchestrator). The dispatch runs in the
        background so the message endpoint returns immediately.
        """
        message = Message(
            conversation_id=conversation.id,
            sender_type=SenderType.USER,
            sender_id=None,
            content=content,
            message_type=MessageType.NORMAL,
        )
        self._session.add(message)
        await self._session.flush()

        task = Task(
            workspace_id=conversation.workspace_id,
            conversation_id=conversation.id,
            title=content[:255],
            description=content,
            assigned_agent_id=None,
            status=TaskStatus.PENDING,
            priority="normal",
            input_message_id=message.id,
        )
        self._session.add(task)
        await commit_or_conflict(self._session)
        await self._session.refresh(message)
        await self._session.refresh(task)
        await TaskService(self._session).enqueue(task)

        result = MessageHubResult(
            message=MessageRead.model_validate(message),
            task=TaskRead.model_validate(task),
            assigned_agent=None,
        )
        await self._broadcaster.broadcast_to_workspace(
            conversation.workspace_id,
            create_event("message.created", result.message),
        )
        await self._broadcaster.broadcast_to_workspace(
            conversation.workspace_id,
            create_event("task.status_changed", result.task),
        )
        self._dispatch_to_node(task.id, node.id)
        return result

    def _dispatch_to_node(self, task_id: int, node_id: int) -> None:
        """Schedule background dispatch to an integration node."""
        background_task = asyncio.create_task(_run_node_dispatch(task_id, node_id))
        background_task.add_done_callback(_log_background_result)

    async def _get_conversation(self, conversation_id: int) -> Conversation:
        conversation = await self._session.get(Conversation, conversation_id)
        if conversation is None:
            raise AppError(404, "Conversation not found")
        return conversation

    @staticmethod
    def _select_agent(content: str, agents: list[Agent]) -> Agent:
        agents_by_name = {agent.name: agent for agent in agents}
        for name in parse_mentions(content):
            agent = agents_by_name.get(name)
            if agent is not None:
                return agent

        # A direct match also supports Chinese text immediately following the
        # mention, where a generic parser cannot infer the name boundary.
        mentioned: list[tuple[int, int, Agent]] = []
        for agent in agents:
            positions = [
                position
                for marker in ("@", "＠")
                if (position := content.find(f"{marker}{agent.name}")) >= 0
            ]
            if positions:
                mentioned.append((min(positions), -len(agent.name), agent))

        if mentioned:
            mentioned.sort(key=lambda item: (item[0], item[1], item[2].id))
            return mentioned[0][2]

        default_agent = next(
            (agent for agent in agents if agent.name == DEFAULT_AGENT_NAME), None
        )
        if default_agent is None:
            raise AppError(
                422,
                f'Default agent "{DEFAULT_AGENT_NAME}" is not configured in the workspace',
            )
        return default_agent


async def receive_user_message(
    conversation_id: int, content: str
) -> MessageHubResult:
    """Standalone MessageHub entry point using the application's session factory."""
    async with AsyncSessionLocal() as session:
        return await MessageHub(session).receive_user_message(conversation_id, content)
