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
from app.core.redaction import redact_content
from app.core.relay import MAX_RELAY_AGENTS, dump_relay_agent_ids
from app.core.trace_context import stamp_new_message, stamp_task
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
from app.services.task_lease import release_task_lease
from app.services.task_service import TaskService
from app.websocket import WebSocketManager, create_event, websocket_manager

logger = logging.getLogger(__name__)

DEFAULT_AGENT_NAME = "项目总设计师"
_MENTION_PATTERN = re.compile(r"[@＠]([\w-]+)")
_ROLE_ALIASES: dict[str, tuple[str, ...]] = {
    "project_architect": ("架构师", "总设计师", "项目总设计师", "方案设计"),
    "agent_engineer": ("Agent工程师", "后端工程师", "后端", "后台"),
    "frontend_designer": ("前端设计师", "前端", "UI", "视觉"),
    "knowledge_manager": ("知识库管理员", "知识库", "资料管理员", "文档管理员"),
    "qa_engineer": ("测试专员", "测试", "测试工程师", "QA", "质量审核"),
    "operations_engineer": ("运维工程师", "运维", "SRE"),
}
_ASCII_WORD_CHARS = frozenset(
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_"
)
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
        # A4：任务级租约释放统一走 task_lease（execution_token 写点收敛）。
        release_task_lease(task)

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


def _dedupe_agents(agents: list[Agent]) -> list[Agent]:
    """Keep the first occurrence of each Agent for an ordered relay chain."""
    seen: set[int] = set()
    unique: list[Agent] = []
    for agent in agents:
        if agent.id in seen:
            continue
        seen.add(agent.id)
        unique.append(agent)
    return unique


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
        raw_content = content.strip()
        if not raw_content:
            raise AppError(422, "Message content cannot be empty")
        # REQ-D6：存储与广播用脱敏内容；@ 路由仍按原文解析，避免脱敏影响派发。
        content = redact_content(raw_content) or ""

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
                (
                    f"Workspace has {active_count} active tasks "
                    f"(max {MAX_RUNNING_TASKS_PER_WORKSPACE}). "
                    "Please wait for some to complete."
                ),
            )
        agents = list(
            await self._session.scalars(
                select(Agent)
                .where(Agent.workspace_id == conversation.workspace_id)
                .order_by(Agent.id)
            )
        )

        nodes = list(
            await self._session.scalars(
                select(IntegrationNode).where(
                    IntegrationNode.workspace_id == conversation.workspace_id
                )
            )
        )
        mention_targets = self._resolve_mention_targets(raw_content, agents, nodes)
        first_target = mention_targets[0] if mention_targets else None
        if isinstance(first_target, IntegrationNode):
            return await self._create_node_task(conversation, content, first_target)

        if not agents:
            raise AppError(400, "Workspace has no available agents")

        # FR1：按 @ 出现顺序去重成接力链；仅当内部 Agent ≥ 2 时才启用接力。
        relay_agents = _dedupe_agents(
            [
                target
                for target in mention_targets
                if isinstance(target, Agent)
            ]
        )[:MAX_RELAY_AGENTS]
        relay_agent_ids_json = dump_relay_agent_ids(
            [agent.id for agent in relay_agents]
        )
        assigned_agent = (
            relay_agents[0]
            if relay_agents
            else self._default_agent(agents)
        )

        message = Message(
            conversation_id=conversation.id,
            sender_type=SenderType.USER,
            sender_id=None,
            content=content,
            message_type=MessageType.NORMAL,
        )
        stamp_new_message(message)
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
            relay_agent_ids_json=relay_agent_ids_json,
        )
        stamp_task(task, source_message=message)
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

    @staticmethod
    def _mention_candidates(
        agents: list[Agent], nodes: list[IntegrationNode]
    ) -> list[tuple[str, int, Agent | IntegrationNode]]:
        """Collect mentionable terms as (term, priority, target) candidates.

        Priority 0 = internal Agent, 1 = integration node; on an equal-length
        match the lower priority wins (internal Agent first).
        """
        candidates: list[tuple[str, int, Agent | IntegrationNode]] = []
        for agent in agents:
            terms = {agent.name, agent.role, getattr(agent, "model_name", None)}
            terms.update(_ROLE_ALIASES.get(agent.role, ()))
            for term in terms:
                if term and term.strip():
                    candidates.append((term.strip(), 0, agent))

        for node in nodes:
            terms = {node.name, getattr(node, "provider", None)}
            for term in terms:
                if term and term.strip():
                    candidates.append((term.strip(), 1, node))
        return candidates

    @staticmethod
    def _best_mention_at(
        content: str,
        at_idx: int,
        candidates: list[tuple[str, int, Agent | IntegrationNode]],
    ) -> tuple[int, Agent | IntegrationNode] | None:
        """Return (term length, target) for the best match starting at at_idx."""
        subtext = content[at_idx + 1:]
        subtext_lower = subtext.lower()
        best: tuple[int, int, Agent | IntegrationNode] | None = None
        for term, priority, target in candidates:
            term_lower = term.lower()
            if not subtext_lower.startswith(term_lower):
                continue

            term_len = len(term_lower)
            if term[-1] in _ASCII_WORD_CHARS:
                if term_len < len(subtext) and subtext[term_len] in _ASCII_WORD_CHARS:
                    continue

            match_score = (term_len, -priority)
            if best is None or match_score > (best[0], -best[1]):
                best = (term_len, priority, target)
        if best is None:
            return None
        return best[0], best[2]

    @classmethod
    def _resolve_mention_targets(
        cls,
        content: str,
        agents: list[Agent],
        nodes: list[IntegrationNode],
    ) -> list[Agent | IntegrationNode]:
        """Return every valid @mention target in first-occurrence order, deduped.

        The first element is exactly the target the previous single-target
        resolver returned, so existing routing semantics stay unchanged; the
        remaining elements are the relays the user wrote after it.
        """
        if not content:
            return []

        candidates = cls._mention_candidates(agents, nodes)
        if not candidates:
            return []

        targets: list[Agent | IntegrationNode] = []
        seen: set[tuple[str, int]] = set()
        position = 0
        while position < len(content):
            at_idx = -1
            for index in range(position, len(content)):
                if content[index] in ("@", "＠"):
                    at_idx = index
                    break
            if at_idx < 0:
                break
            if at_idx > 0 and content[at_idx - 1] in _ASCII_WORD_CHARS:
                position = at_idx + 1
                continue

            matched = cls._best_mention_at(content, at_idx, candidates)
            if matched is None:
                position = at_idx + 1
                continue

            term_len, target = matched
            key = (type(target).__name__, target.id)
            if key not in seen:
                seen.add(key)
                targets.append(target)
            position = at_idx + 1 + term_len
        return targets

    @classmethod
    def _resolve_mention_target(
        cls,
        content: str,
        agents: list[Agent],
        nodes: list[IntegrationNode],
    ) -> Agent | IntegrationNode | None:
        """Find the earliest valid @mention target in the content.

        Supports:
        - Internal agents via agent.name, agent.role, agent.model_name, and _ROLE_ALIASES.
        - Integration nodes via node.name and node.provider.
        - Chinese text immediately following the mention without delimiter.
        - Full-width '＠' and half-width '@'.
        - Excludes email addresses (where '@' is preceded by an ASCII word char).
        - Word boundary enforcement for English candidate tokens (e.g. '@coder' does not match 'code').
        - Longest-match prioritization when candidate names share a prefix.
        - Internal Agent taking priority over IntegrationNode if both match at the same earliest position.
        """
        targets = cls._resolve_mention_targets(content, agents, nodes)
        return targets[0] if targets else None

    async def _match_integration_node(
        self, content: str, agents: list[Agent], conversation: Conversation
    ) -> IntegrationNode | None:
        """Return the integration node if the first valid mention in content is an
        integration node rather than an internal agent."""
        nodes = list(
            await self._session.scalars(
                select(IntegrationNode).where(
                    IntegrationNode.workspace_id == conversation.workspace_id
                )
            )
        )
        target = self._resolve_mention_target(content, agents, nodes)
        return target if isinstance(target, IntegrationNode) else None

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
        stamp_new_message(message)
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
        stamp_task(task, source_message=message)
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

    @classmethod
    def _default_agent(cls, agents: list[Agent]) -> Agent:
        default_agent = next(
            (agent for agent in agents if agent.name == DEFAULT_AGENT_NAME), None
        )
        if default_agent is None:
            raise AppError(
                422,
                f'Default agent "{DEFAULT_AGENT_NAME}" is not configured in the workspace',
            )
        return default_agent

    @classmethod
    def _select_agent(cls, content: str, agents: list[Agent]) -> Agent:
        target = cls._resolve_mention_target(content, agents, [])
        if isinstance(target, Agent):
            return target
        return cls._default_agent(agents)


async def receive_user_message(
    conversation_id: int, content: str
) -> MessageHubResult:
    """Standalone MessageHub entry point using the application's session factory."""
    async with AsyncSessionLocal() as session:
        return await MessageHub(session).receive_user_message(conversation_id, content)
