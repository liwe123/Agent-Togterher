import re
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.errors import AppError
from app.api.persistence import commit_or_conflict
from app.db.session import AsyncSessionLocal
from app.models import (
    Agent,
    Conversation,
    Message,
    MessageType,
    SenderType,
    Task,
    TaskStatus,
)
from app.schemas import AgentRead, MessageCreate, MessageRead, TaskRead
from app.websocket import WebSocketManager, create_event, websocket_manager

DEFAULT_AGENT_NAME = "项目总设计师"
_MENTION_PATTERN = re.compile(r"[@＠]([\w-]+)")


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
    assigned_agent: AgentRead


class MessageHub:
    """Persist incoming chat messages and dispatch user work to agents."""

    def __init__(
        self,
        session: AsyncSession,
        broadcaster: WebSocketManager = websocket_manager,
    ) -> None:
        self._session = session
        self._broadcaster = broadcaster

    async def receive_user_message(
        self, conversation_id: int, content: str
    ) -> MessageHubResult:
        content = content.strip()
        if not content:
            raise AppError(422, "Message content cannot be empty")

        conversation = await self._get_conversation(conversation_id)
        agents = list(
            await self._session.scalars(
                select(Agent)
                .where(Agent.workspace_id == conversation.workspace_id)
                .order_by(Agent.id)
            )
        )
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

        from app.core.orchestrator import run_task
        import asyncio
        asyncio.create_task(run_task(task.id))

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
        return result

    async def receive_message(
        self, conversation_id: int, payload: MessageCreate
    ) -> MessageHubResult | MessageRead:
        """Route user messages through dispatch while preserving internal messages."""
        if payload.sender_type == SenderType.USER:
            return await self.receive_user_message(conversation_id, payload.content)

        conversation = await self._get_conversation(conversation_id)
        if payload.sender_type == SenderType.AGENT:
            if payload.sender_id is None:
                raise AppError(422, "sender_id is required when sender_type is agent")
            agent = await self._session.get(Agent, payload.sender_id)
            if agent is None or agent.workspace_id != conversation.workspace_id:
                raise AppError(
                    422, "Sender agent must belong to the conversation workspace"
                )

        message = Message(conversation_id=conversation_id, **payload.model_dump())
        self._session.add(message)
        await commit_or_conflict(self._session)
        await self._session.refresh(message)
        message_data = MessageRead.model_validate(message)
        await self._broadcaster.broadcast_to_workspace(
            conversation.workspace_id,
            create_event("message.created", message_data),
        )
        return message_data

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
