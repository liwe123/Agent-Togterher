from __future__ import annotations

import logging
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Agent, Message, Task, TaskStatus
from app.websocket.events import create_event

logger = logging.getLogger(__name__)


class WorkspaceSnapshotBuilder:
    """Build a point-in-time snapshot of workspace state for reconnection sync."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def build_snapshot(self, workspace_id: int) -> dict[str, Any]:
        """Build a complete snapshot of workspace state."""
        tasks = list(
            await self._session.scalars(
                select(Task)
                .where(Task.workspace_id == workspace_id)
                .order_by(Task.id.desc())
                .limit(50)
            )
        )
        agents = list(
            await self._session.scalars(
                select(Agent).where(Agent.workspace_id == workspace_id).order_by(Agent.id)
            )
        )
        recent_messages = list(
            await self._session.scalars(
                select(Message)
                .where(Message.conversation_id.in_(
                    select(Task.conversation_id)
                    .where(Task.workspace_id == workspace_id)
                    .where(Task.conversation_id.isnot(None))
                ))
                .order_by(Message.id.desc())
                .limit(20)
            )
        )

        return {
            "workspace_id": workspace_id,
            "tasks": [
                {
                    "id": t.id,
                    "title": t.title,
                    "status": t.status.value if t.status else None,
                    "priority": t.priority,
                    "assigned_agent_id": t.assigned_agent_id,
                    "result": t.result,
                    "created_at": t.created_at.isoformat() if t.created_at else None,
                    "updated_at": t.updated_at.isoformat() if t.updated_at else None,
                }
                for t in tasks
            ],
            "agents": [
                {
                    "id": a.id,
                    "name": a.name,
                    "role": a.role,
                    "status": a.status,
                }
                for a in agents
            ],
            "recent_messages": [
                {
                    "id": m.id,
                    "conversation_id": m.conversation_id,
                    "sender_type": m.sender_type.value if m.sender_type else None,
                    "sender_id": m.sender_id,
                    "content": m.content,
                    "message_type": m.message_type.value if m.message_type else None,
                    "created_at": m.created_at.isoformat() if m.created_at else None,
                }
                for m in recent_messages
            ],
        }

    def create_snapshot_event(self, workspace_id: int, snapshot: dict[str, Any]) -> dict[str, Any]:
        """Create a workspace snapshot event for broadcasting."""
        return create_event("workspace.snapshot", snapshot)
