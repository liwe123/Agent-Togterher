"""External integration node dispatch service.

Wraps the bridge execution result so that dispatching a task to an external
agent node records a TaskStep on the task timeline, writes the result back to
the Task row, and broadcasts the same lifecycle events used by the internal
orchestrator. This keeps the task details page consistent whether a task is
executed by an internal agent or an external node.
"""

from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass
from datetime import timedelta
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
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

TEST_COMMAND_TIMEOUT_SECONDS = 300
CANCELLED_MARKER = "CANCELLED"

_CANCEL_EVENTS: dict[int, asyncio.Event] = {}


def register_cancel_event(task_id: int) -> asyncio.Event:
    event = asyncio.Event()
    _CANCEL_EVENTS[task_id] = event
    return event


def pop_cancel_event(task_id: int) -> asyncio.Event | None:
    return _CANCEL_EVENTS.pop(task_id, None)


@dataclass(frozen=True)
class DispatchPackage:
    """Task-package metadata attached to an external dispatch (P2)."""

    acceptance_criteria: list[str] | None = None
    allowed_paths: list[str] | None = None
    test_command: str | None = None
    budget_seconds: int | None = None
    budget_turns: int | None = None
    dependencies: list[str] | None = None

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


async def _run_test_command(command: str, workdir: Path) -> tuple[bool, str]:
    try:
        process = await asyncio.create_subprocess_shell(
            command,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            cwd=str(workdir),
        )
    except Exception as exc:
        return False, f"test_command 无法启动: {exc}"
    try:
        stdout_bytes, _ = await asyncio.wait_for(
            process.communicate(), timeout=TEST_COMMAND_TIMEOUT_SECONDS
        )
    except asyncio.TimeoutError:
        try:
            process.kill()
            await process.wait()
        except Exception:
            pass
        return False, f"test_command 超时（{TEST_COMMAND_TIMEOUT_SECONDS}s）"
    output = stdout_bytes.decode("utf-8", errors="replace").strip()
    return process.returncode == 0, output or "(无输出)"


def _cancelled_result(task_id: int, node_name: str, provider: str) -> BridgeResult:
    return BridgeResult(
        success=False,
        message=f"任务 {task_id} 已被用户取消",
        metadata={"node": node_name, "provider": provider, "cancelled": True},
    )


async def dispatch_task_to_node(
    session: AsyncSession,
    task: Task,
    node: IntegrationNode,
    *,
    package: DispatchPackage | None = None,
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
    package = package or DispatchPackage()
    cancel_event = register_cancel_event(task.id)
    prepared = bridge.prepare_task(
        task.id,
        task.title,
        task.description,
        acceptance_criteria=package.acceptance_criteria,
        allowed_paths=package.allowed_paths,
        test_command=package.test_command,
        budget_seconds=package.budget_seconds,
        budget_turns=package.budget_turns,
        dependencies=package.dependencies,
        cancel_event=cancel_event,
    )

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
    finally:
        pop_cancel_event(task.id)

    if result.success and getattr(prepared, "test_command", None):
        passed, output = await _run_test_command(
            prepared.test_command, prepared.task_workdir
        )
        test_output_path = prepared.task_workdir / "test_output.txt"
        test_output_path.write_text(output, encoding="utf-8")
        metadata = dict(result.metadata or {})
        metadata.update({"test_command": prepared.test_command, "test_passed": passed})
        suffix = f"\n\n[test_command] {'通过' if passed else '未通过'}\n{output[:2000]}"
        result = BridgeResult(
            success=passed,
            message=result.message + suffix,
            artifacts=list(result.artifacts or []) + [test_output_path],
            metadata=metadata,
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


async def cancel_external_execution(session: AsyncSession, task: Task) -> str | None:
    """Best-effort cancel of an in-flight external dispatch for ``task``.

    1. Signal the in-process bridge via the registered asyncio event.
    2. Drop a CANCELLED marker file into the bridge task dir so host-side
       pollers (CursorBridge) notice even across process restarts.
    3. Fail the running integration TaskStep so the timeline reflects it.
    Returns a human-readable note or None when nothing was running.
    """
    step = await session.scalar(
        select(TaskStep)
        .where(
            TaskStep.task_id == task.id,
            TaskStep.status == "running",
            TaskStep.step_name.like("integration_dispatch:%"),
        )
        .order_by(TaskStep.id.desc())
    )
    if step is None:
        return None

    event = pop_cancel_event(task.id)
    if event is not None:
        event.set()

    note = "已请求取消外部节点执行"
    try:
        input_data = json.loads(step.input or "{}")
        node_id = input_data.get("node_id")
    except Exception:
        node_id = None
    if node_id is not None:
        node = await session.get(IntegrationNode, int(node_id))
        if node is not None:
            marker = (
                Path(get_settings().bridge_root_dir)
                .expanduser()
                / f"workspace-{task.workspace_id}"
                / node.name
                / f"task-{task.id}"
                / CANCELLED_MARKER
            )
            try:
                marker.parent.mkdir(parents=True, exist_ok=True)
                marker.write_text(CANCELLED_MARKER, encoding="utf-8")
                note = f"已请求取消外部节点执行（{node.provider}:{node.name}）"
            except Exception:
                logger.warning("Failed to write cancel marker", exc_info=True)

    step.status = "failed"
    step.output = note
    step.finished_at = utc_now()
    await session.commit()
    return note


async def recover_orphan_integration_steps(
    session: AsyncSession,
    *,
    lease_minutes: int = 10,
) -> int:
    """Mark running integration steps as failed if their lease expired.

    Called on backend startup: any ``running`` integration_dispatch step whose
    task has no active cancel registry entry and started longer than the lease
    ago belongs to a dead backend process (P2 orphan recovery).
    """
    threshold = utc_now() - timedelta(minutes=lease_minutes)
    steps = list(
        await session.scalars(
            select(TaskStep).where(
                TaskStep.status == "running",
                TaskStep.step_name.like("integration_dispatch:%"),
                TaskStep.started_at < threshold,
            )
        )
    )
    recovered = 0
    for step in steps:
        task = await session.get(Task, step.task_id)
        step.status = "failed"
        step.output = f"孤儿恢复：backend 重启后租约超 {lease_minutes} 分钟未完成"
        step.finished_at = utc_now()
        if task is not None and task.status == TaskStatus.RUNNING:
            task.status = TaskStatus.FAILED
            task.result = "外部执行中断（backend 重启），已标记失败"
            task.updated_at = utc_now()
        recovered += 1
    if recovered:
        await session.commit()
    return recovered


__all__ = [
    "BridgeResult",
    "BridgeTask",
    "DispatchPackage",
    "build_bridge",
    "cancel_external_execution",
    "dispatch_task_to_node",
    "pop_cancel_event",
    "recover_orphan_integration_steps",
    "register_cancel_event",
    "select_available_node",
]
