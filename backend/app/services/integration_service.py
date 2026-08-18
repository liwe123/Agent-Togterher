"""External integration node dispatch service.

Wraps the bridge execution result so that dispatching a task to an external
agent node records a TaskStep on the task timeline, writes the result back to
the Task row, and broadcasts the same lifecycle events used by the internal
orchestrator. This keeps the task details page consistent whether a task is
executed by an internal agent or an external node.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.base import utc_now
from app.models.enums import TaskStatus
from app.models.integration_node import IntegrationNode
from app.models.task import Task, TaskStep
from app.services.audit_service import record_audit_log
from app.services.bridge import BaseBridge, BridgeResult, BridgeTask
from app.services.codex_bridge import CodexBridge
from app.services.cursor_bridge import CursorBridge
from app.websocket import create_event
from app.websocket.manager import WebSocketManager, websocket_manager

logger = logging.getLogger(__name__)

_BRIDGE_FACTORIES: dict[str, Any] = {
    "cursor": lambda ws, name: CursorBridge(ws, name),
    "codex": lambda ws, name: CodexBridge(ws, name),
}


def build_bridge(provider: str, workspace_id: int, name: str) -> BaseBridge:
    factory = _BRIDGE_FACTORIES.get(provider.lower())
    if factory is None:
        raise ValueError(f"Provider '{provider}' has no registered bridge")
    return factory(workspace_id, name)


async def select_available_node(
    session: AsyncSession,
    workspace_id: int,
    *,
    capabilities: list[str] | None = None,
    node_id: int | None = None,
) -> IntegrationNode | None:
    """Pick a node for dispatch.

    If ``node_id`` is provided, that node is returned (caller verifies
    workspace). Otherwise, online/busy nodes are filtered by capability and
    ordered by current load then id.
    """
    if node_id is not None:
        return await session.get(IntegrationNode, node_id)

    statement = (
        select(IntegrationNode)
        .where(
            IntegrationNode.workspace_id == workspace_id,
            IntegrationNode.status.in_(["online", "busy"]),
        )
        .order_by(
            IntegrationNode.current_task_count.asc(),
            IntegrationNode.last_heartbeat_at.desc().nulls_last(),
            IntegrationNode.id.asc(),
        )
    )
    candidates = list(await session.scalars(statement))
    if not capabilities:
        return candidates[0] if candidates else None

    wanted = {capability.lower() for capability in capabilities}
    for node in candidates:
        node_caps = {cap.lower() for cap in _parse_capabilities(node.capabilities_json)}
        if wanted.issubset(node_caps):
            return node
    return None


def _parse_capabilities(raw: str | None) -> list[str]:
    if not raw:
        return []
    try:
        data = json.loads(raw)
        return data if isinstance(data, list) else []
    except Exception:
        return []


async def dispatch_task_to_node(
    session: AsyncSession,
    task: Task,
    node: IntegrationNode,
    *,
    broadcaster: WebSocketManager = websocket_manager,
    step_name: str = "integration_dispatch",
) -> BridgeResult:
    """Run ``task`` on ``node`` through the bridge layer and write the
    result back to the task timeline.

    The function performs the full lifecycle used by the integration dispatch
    endpoint:

    1. Build the bridge and prepare the workdir (PROMPT.md / task.json /
       output.md / events.jsonl).
    2. Create a running ``TaskStep`` so the dispatch shows up in the task
       details page.
    3. Execute the bridge.
    4. Mark the step completed/failed with the bridge output as the step
       output.
    5. Update the task status and result so downstream UIs reflect the
       external execution.
    6. Update node load and heartbeat, write an audit log, broadcast
       ``integration.status_changed`` and ``task.step_changed`` events.
    """
    if node.workspace_id != task.workspace_id:
        raise ValueError("Node must belong to the same workspace as the task")

    bridge = build_bridge(node.provider, node.workspace_id, node.name)
    prepared = bridge.prepare_task(task.id, task.title, task.description)

    node.current_task_count = min(node.current_task_count + 1, node.max_concurrency)
    node.status = "busy" if node.current_task_count >= node.max_concurrency else "online"
    node.last_heartbeat_at = utc_now()
    await session.commit()
    await session.refresh(node)

    started_at = utc_now()
    step = TaskStep(
        task_id=task.id,
        agent_id=None,
        step_name=f"{step_name}:{node.provider}:{node.name}",
        input=json.dumps(
            {
                "node_id": node.id,
                "node_name": node.name,
                "provider": node.provider,
                "mode": node.mode,
                "task_title": task.title,
                "description": task.description,
            },
            ensure_ascii=False,
        ),
        status="running",
        started_at=started_at,
    )
    session.add(step)
    await session.commit()
    await session.refresh(step)
    await broadcaster.broadcast_to_workspace(
        task.workspace_id,
        create_event(
            "task.step_changed",
            {
                "id": step.id,
                "task_id": task.id,
                "agent_id": None,
                "step_name": step.step_name,
                "input": step.input,
                "output": None,
                "status": "running",
                "started_at": step.started_at.isoformat() if step.started_at else None,
                "finished_at": None,
            },
        ),
    )

    try:
        result = await bridge.execute(prepared)
    except Exception as exc:
        logger.exception(
            "Integration node dispatch failed",
            extra={"task_id": task.id, "node_id": node.id},
        )
        result = BridgeResult(
            success=False,
            message=f"Integration dispatch failed: {exc}",
            metadata={"node": node.name, "provider": node.provider},
        )

    step.status = "completed" if result.success else "failed"
    step.output = result.message
    step.finished_at = utc_now()
    await session.commit()
    await session.refresh(step)
    await broadcaster.broadcast_to_workspace(
        task.workspace_id,
        create_event(
            "task.step_changed",
            {
                "id": step.id,
                "task_id": task.id,
                "agent_id": None,
                "step_name": step.step_name,
                "input": step.input,
                "output": step.output,
                "status": step.status,
                "started_at": step.started_at.isoformat() if step.started_at else None,
                "finished_at": step.finished_at.isoformat() if step.finished_at else None,
            },
        ),
    )

    task.status = TaskStatus.COMPLETED if result.success else TaskStatus.FAILED
    task.result = result.message
    task.updated_at = utc_now()
    await session.commit()
    await session.refresh(task)
    await broadcaster.broadcast_to_workspace(
        task.workspace_id,
        create_event(
            "task.status_changed",
            {
                "id": task.id,
                "status": task.status.value,
                "result": task.result,
                "updated_at": task.updated_at.isoformat() if task.updated_at else None,
            },
        ),
    )

    node.current_task_count = max(0, node.current_task_count - 1)
    node.status = "online" if node.current_task_count < node.max_concurrency else "busy"
    node.last_heartbeat_at = utc_now()
    await session.commit()
    await session.refresh(node)

    await record_audit_log(
        session,
        workspace_id=node.workspace_id,
        action="integration_node.dispatch",
        resource_type="integration_node",
        resource_id=str(node.id),
        detail={
            "task_id": task.id,
            "success": result.success,
            "provider": node.provider,
            "mode": node.mode,
            "step_id": step.id,
            "artifacts": [str(path) for path in (result.artifacts or [])],
        },
    )
    await broadcaster.broadcast_to_workspace(
        node.workspace_id,
        create_event(
            "integration.status_changed",
            {
                "id": node.id,
                "name": node.name,
                "status": node.status,
                "current_task_count": node.current_task_count,
                "last_heartbeat_at": node.last_heartbeat_at.isoformat()
                if node.last_heartbeat_at
                else None,
            },
        ),
    )

    return result


__all__ = [
    "BridgeResult",
    "BridgeTask",
    "build_bridge",
    "dispatch_task_to_node",
    "select_available_node",
]
