"""C-185: DAG 工作流引擎。

把 workflow_templates.nodes_json 中声明式的节点数组变成真正的 DAG 执行：

1. ``parse_nodes``：容错解析 nodes_json；
2. ``topological_sort``：Kahn 分层拓扑排序（层内节点可并行）；
3. ``execute_dag``：按层推进，层内 ``asyncio.gather`` 并行执行节点，
   每个节点执行后通过 orchestrator 的 ``save_task_step`` 落库，
   步骤带 node_id / dependencies_json / order_index（C-185 新列）；
4. ``run_workflow_dag``：后台任务入口——认领 Task（租约兼容）、
   维护 WorkflowRun 生命周期、失败时中止后续层并把任务置 FAILED。

失败语义：某个节点失败后，中止所有后续层的执行；已完成的层保留其
task_steps 记录；任务置 FAILED，WorkflowRun 置 failed。

阶段一执行采用进程内（inline）后台 asyncio 任务直接执行，与现有
``task_execution_mode=inline`` 路径对齐；当前工作流运行路径本就不经过
task_queue 入队，故保持不入队（若未来切到 queue 模式，可在
run_workflow_dag 入口处改为 TaskService.enqueue，语义不变）。

orchestrator 只读复用，不做任何修改。
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections import defaultdict
from typing import Any, Awaitable, Callable
from uuid import uuid4

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.orchestrator import (
    APPROVAL_POLL_INTERVAL_SECONDS,
    APPROVAL_TIMEOUT_SECONDS,
    HUMAN_APPROVAL_STEP_NAME,
    TASK_LEASE_DURATION,
    call_agent_model,
    save_task_step,
    update_task_status,
)
from app.db.base import utc_now
from app.db.session import AsyncSessionLocal
from app.models import Agent, Task, TaskStatus
from app.models.task import TaskStep
from app.models.workflow import WorkflowRun

logger = logging.getLogger(__name__)

# 节点执行器：传入（节点会话, 任务, 节点 dict），返回（Agent|None, 输出文本）。
# 可注入替换以便测试。
NodeExecutor = Callable[[AsyncSession, Task, dict], Awaitable[tuple[Agent | None, str]]]

_BACKEND_TASK_STEP_NAME_LIMIT = 255


class DagWorkflowError(ValueError):
    """DAG 定义非法（缺 id / 未知依赖 / 环等），消息面向用户展示。"""


class DagNodeExecutionError(Exception):
    """某个节点执行失败，携带 node_id 与错误消息。"""

    def __init__(self, node_id: str, message: str) -> None:
        super().__init__(message)
        self.node_id = node_id
        self.message = message


def parse_nodes(nodes_json: str | list) -> list[dict]:
    """解析 nodes_json 为节点数组。

    空字符串 / 空数组返回空列表；非法 JSON、非数组类型抛 ValueError。
    """
    if nodes_json is None:
        return []
    if isinstance(nodes_json, list):
        data: Any = nodes_json
    elif isinstance(nodes_json, str):
        text = nodes_json.strip()
        if not text:
            return []
        try:
            data = json.loads(text)
        except (json.JSONDecodeError, TypeError) as exc:
            raise ValueError(f"nodes_json 不是合法的 JSON：{exc}") from exc
    else:
        raise ValueError("nodes_json 类型不支持，应为 JSON 字符串或节点数组")

    if not isinstance(data, list):
        raise ValueError("nodes_json 必须是节点数组")
    if not data:
        return []
    for node in data:
        if not isinstance(node, dict):
            raise ValueError("nodes_json 中存在非对象节点")
    return data


def _node_dependencies(node: dict) -> list[str]:
    raw = node.get("dependencies")
    if raw is None:
        raw = node.get("depends_on")
    if raw is None:
        return []
    if not isinstance(raw, list) or not all(isinstance(d, str) for d in raw):
        raise ValueError(
            f"节点 {node.get('id')} 的 dependencies 必须是字符串数组"
        )
    return raw


def topological_sort(nodes: list[dict]) -> list[list[dict]]:
    """Kahn 分层拓扑排序。

    返回按层分组的节点列表：第一层为无依赖节点，其后每层节点的依赖
    全部落在之前的层中。节点缺 id、依赖未知节点或存在环时抛
    ValueError（中文错误消息）。
    """
    node_map: dict[str, dict] = {}
    for node in nodes:
        node_id = node.get("id")
        if not node_id or not isinstance(node_id, str):
            raise ValueError("工作流节点缺少唯一 id")
        if node_id in node_map:
            raise ValueError(f"工作流节点 id 重复：{node_id}")
        node_map[node_id] = node

    dependencies: dict[str, list[str]] = {}
    dependents: dict[str, list[str]] = defaultdict(list)
    indegree: dict[str, int] = {}
    for node_id, node in node_map.items():
        deps = _node_dependencies(node)
        for dep in deps:
            if dep not in node_map:
                raise ValueError(f"节点 {node_id} 依赖了未知的节点 id：{dep}")
            dependents[dep].append(node_id)
        dependencies[node_id] = deps
        indegree[node_id] = len(deps)

    current = [node_id for node_id, degree in indegree.items() if degree == 0]
    layers: list[list[dict]] = []
    visited = 0
    while current:
        current.sort()  # 同层输出顺序稳定（按 node_id 字典序）
        layers.append([node_map[node_id] for node_id in current])
        visited += len(current)
        next_layer: list[str] = []
        for node_id in current:
            for dependent in dependents[node_id]:
                indegree[dependent] -= 1
                if indegree[dependent] == 0:
                    next_layer.append(dependent)
        current = next_layer

    if visited != len(node_map):
        cyclic = sorted(node_id for node_id, degree in indegree.items() if degree > 0)
        raise ValueError(f"工作流存在循环依赖，涉及节点：{', '.join(cyclic)}")
    return layers


async def default_node_executor(
    session: AsyncSession,
    task: Task,
    node: dict,
) -> tuple[Agent | None, str]:
    """默认节点执行体：按 agent_role 匹配工作区 Agent 并调用模型。"""
    role = str(node.get("agent_role") or "").strip()
    agent: Agent | None = None
    if role:
        agent = await session.scalar(
            select(Agent)
            .where(
                Agent.workspace_id == task.workspace_id,
                or_(Agent.role == role, Agent.name == role),
            )
            .order_by(Agent.id)
        )
        if agent is None:
            raise DagNodeExecutionError(
                str(node.get("id")),
                f"未在工作区中找到角色为「{role}」的可用 Agent",
            )
    else:
        agent = await session.scalar(
            select(Agent)
            .where(Agent.workspace_id == task.workspace_id)
            .order_by(Agent.id)
        )
    if agent is None:
        raise DagNodeExecutionError(
            str(node.get("id")),
            "工作区内没有任何可用 Agent，无法执行节点",
        )

    prompt = str(node.get("prompt_template") or "")
    completion = await call_agent_model(
        task,
        agent,
        extra_messages=[{"role": "user", "content": prompt}] if prompt else None,
    )
    return agent, completion.content


def _step_name_for(node: dict) -> str:
    name = str(node.get("name") or node.get("id") or "workflow_node")
    return name[:_BACKEND_TASK_STEP_NAME_LIMIT]


async def _run_human_approval_node(
    node: dict,
    node_id: str,
    dependencies: list[str],
    order_index: int,
    task_id: int,
    session_factory: async_sessionmaker[AsyncSession],
) -> str:
    """C-184×C-185 集成：DAG 中的 human_approval 节点。

    与 orchestrator._request_approval 同一套语义（HUMAN_APPROVAL_STEP_NAME
    步骤 + WAITING_APPROVAL 状态 + DB 轮询跨进程解耦），但以 DAG 节点
    视角落库（步骤带 node_id/dependencies_json/order_index）：

    - approved：步骤置 approved、任务回 RUNNING，返回审批输出文本；
    - rejected / 超时（按驳回）：步骤置 rejected、任务置 FAILED，
      抛 DagNodeExecutionError 中止后续层（终态步骤已落库，不重复记）。
    """
    async with session_factory() as session:
        task = await session.get(Task, task_id)
        if task is None:
            raise DagNodeExecutionError(
                node_id, f"任务 #{task_id} 不存在，无法执行审批节点"
            )
        description = str(node.get("description") or node.get("prompt_template") or "")
        step = await save_task_step(
            session,
            task,
            None,
            step_name=HUMAN_APPROVAL_STEP_NAME,
            status="waiting",
            input_text=description or None,
        )
        step.node_id = node_id
        step.dependencies_json = json.dumps(dependencies, ensure_ascii=False)
        step.order_index = order_index
        await session.commit()
        step_id = step.id

    async with session_factory() as session:
        task = await session.get(Task, task_id)
        if task is not None:
            await update_task_status(session, task, TaskStatus.WAITING_APPROVAL)
    logger.info(
        "DAG human approval node waiting (task %s, node %s)", task_id, node_id
    )

    loop = asyncio.get_running_loop()
    deadline = loop.time() + APPROVAL_TIMEOUT_SECONDS
    final_status: str | None = None
    while True:
        async with session_factory() as session:
            status = await session.scalar(
                select(TaskStep.status).where(TaskStep.id == step_id)
            )
        if status in {"approved", "rejected"}:
            final_status = str(status)
            break
        if loop.time() >= deadline:
            final_status = "timeout"
            break
        await asyncio.sleep(APPROVAL_POLL_INTERVAL_SECONDS)

    if final_status == "approved":
        async with session_factory() as session:
            task = await session.get(Task, task_id)
            step = await session.get(TaskStep, step_id)
            if task is not None and step is not None:
                await save_task_step(session, task, None, step=step, status="approved")
                await update_task_status(session, task, TaskStatus.RUNNING)
        logger.info("DAG human approval node approved (task %s)", task_id)
        return "人工审批通过"

    note = (
        "人工驳回"
        if final_status == "rejected"
        else f"审批等待超时（{APPROVAL_TIMEOUT_SECONDS} 秒），按驳回处理"
    )
    async with session_factory() as session:
        task = await session.get(Task, task_id)
        step = await session.get(TaskStep, step_id)
        if task is not None and step is not None:
            await save_task_step(
                session, task, None, step=step, status="rejected", output=note
            )
            await update_task_status(
                session, task, TaskStatus.FAILED, result=f"人工驳回：{note}"
            )
    logger.warning(
        "DAG human approval node %s (task %s, node %s)", final_status, task_id, node_id
    )
    raise DagNodeExecutionError(node_id, note)


async def _run_node(
    node: dict,
    order_index: int,
    task_id: int,
    session_factory: async_sessionmaker[AsyncSession],
    executor: NodeExecutor,
) -> tuple[str, str]:
    """执行单个节点并落库步骤，返回 (node_id, 输出)。

    步骤先经 orchestrator.save_task_step 落库，再补写 C-185 的
    node_id / dependencies_json / order_index 三列并提交。

    C-184 集成：type=human_approval 的节点不调模型，走人工审批挂起
    （落 waiting 步骤 → 任务置 WAITING_APPROVAL → 轮询审批结果）；
    其终态步骤（approved/rejected）由审批分支自身落库，失败时不重复
    落 failed step，直接上抛中止后续层。
    """
    node_id = str(node["id"])
    dependencies = _node_dependencies(node)
    step_name = _step_name_for(node)
    prompt = str(node.get("prompt_template") or "")
    if str(node.get("type") or "") == "human_approval":
        output = await _run_human_approval_node(
            node,
            node_id,
            dependencies,
            order_index,
            task_id,
            session_factory,
        )
        return node_id, output
    try:
        async with session_factory() as session:
            task = await session.get(Task, task_id)
            if task is None:
                raise DagNodeExecutionError(node_id, f"任务 #{task_id} 不存在，无法执行节点")
            try:
                agent, output = await executor(session, task, node)
            except DagNodeExecutionError:
                raise
            except Exception as exc:
                raise DagNodeExecutionError(node_id, str(exc) or exc.__class__.__name__) from exc
            step = await save_task_step(
                session,
                task,
                agent,
                status="completed",
                step_name=step_name,
                input_text=prompt or None,
                output=output,
            )
            step.node_id = node_id
            step.dependencies_json = json.dumps(dependencies, ensure_ascii=False)
            step.order_index = order_index
            await session.commit()
        return node_id, output
    except DagNodeExecutionError as exc:
        # 失败也要把 step 记录落库（agent 未知则留空）。
        try:
            async with session_factory() as session:
                task = await session.get(Task, task_id)
                if task is not None:
                    step = await save_task_step(
                        session,
                        task,
                        None,
                        status="failed",
                        step_name=step_name,
                        input_text=prompt or None,
                        output=exc.message,
                    )
                    step.node_id = node_id
                    step.dependencies_json = json.dumps(dependencies, ensure_ascii=False)
                    step.order_index = order_index
                    await session.commit()
        except Exception:  # noqa: BLE001 — 落库失败不能掩盖原始执行错误
            logger.exception(
                "Failed to persist failed DAG step", extra={"node_id": node_id}
            )
        raise


async def execute_dag(
    layers: list[list[dict]],
    *,
    task: Task,
    session_factory: async_sessionmaker[AsyncSession],
    executor: NodeExecutor | None = None,
) -> dict[str, str]:
    """按层推进执行 DAG，层内 gather 并行。

    返回 {node_id: 输出文本}。任一节点失败：该节点 step 记 failed，
    中止后续所有层（已完成的层保留 step），抛出 DagNodeExecutionError。
    """
    exec_fn = executor or default_node_executor
    outputs: dict[str, str] = {}
    order_counter = 0
    for layer in layers:
        indexed = [(node, order_counter + offset) for offset, node in enumerate(layer)]
        order_counter += len(layer)
        results = await asyncio.gather(
            *[
                _run_node(node, order_index, task.id, session_factory, exec_fn)
                for node, order_index in indexed
            ],
            return_exceptions=True,
        )
        for result in results:
            if isinstance(result, DagNodeExecutionError):
                raise result
            if isinstance(result, BaseException):  # pragma: no cover — 防御
                raise result
            node_id, output = result
            outputs[node_id] = output
    return outputs


async def run_workflow_dag(
    task_id: int,
    run_id: int,
    layers: list[list[dict]],
    *,
    session_factory: async_sessionmaker[AsyncSession] = AsyncSessionLocal,
    executor: NodeExecutor | None = None,
) -> None:
    """后台执行的 DAG 工作流入口（由端点以 asyncio.create_task 调度）。

    - 开始：把 PENDING 任务认领为 RUNNING（写 execution_token 租约，
      与 worker 租约语义兼容）；
    - 终态：全部节点成功 → 任务 COMPLETED、WorkflowRun completed；
      任一节点失败 → 中止后续层、任务 FAILED、WorkflowRun failed。
    """
    task: Task | None = None
    try:
        async with session_factory() as session:
            task = await session.get(Task, task_id)
            run = await session.get(WorkflowRun, run_id)
            if task is None or run is None:
                logger.warning(
                    "DAG workflow run skipped: task or run record missing",
                    extra={"task_id": task_id, "run_id": run_id},
                )
                return
            if task.status == TaskStatus.PENDING:
                task.status = TaskStatus.RUNNING
                task.execution_token = str(uuid4())
                task.execution_token_expires_at = utc_now() + TASK_LEASE_DURATION
            await session.commit()

        outputs = await execute_dag(
            layers,
            task=task,
            session_factory=session_factory,
            executor=executor,
        )

        final_layer = layers[-1] if layers else []
        final_outputs = [outputs.get(str(node["id"]), "") for node in final_layer]
        result_text = "\n\n".join(part for part in final_outputs if part)
        async with session_factory() as session:
            fresh_task = await session.get(Task, task_id)
            fresh_run = await session.get(WorkflowRun, run_id)
            if fresh_task is not None:
                await update_task_status(
                    session,
                    fresh_task,
                    TaskStatus.COMPLETED,
                    result=result_text or None,
                )
            if fresh_run is not None:
                fresh_run.status = "completed"
                await session.commit()
        logger.info(
            "DAG workflow run completed",
            extra={"task_id": task_id, "run_id": run_id, "nodes": len(outputs)},
        )
    except Exception as exc:  # noqa: BLE001 — 后台任务必须自兜底
        logger.exception(
            "DAG workflow run failed",
            extra={"task_id": task_id, "run_id": run_id},
        )
        error_message = str(exc) or exc.__class__.__name__
        try:
            async with session_factory() as session:
                fresh_task = await session.get(Task, task_id)
                fresh_run = await session.get(WorkflowRun, run_id)
                if fresh_task is not None and fresh_task.status not in {
                    TaskStatus.FAILED,
                    TaskStatus.CANCELLED,
                }:
                    await update_task_status(
                        session,
                        fresh_task,
                        TaskStatus.FAILED,
                        result=error_message[:4000],
                    )
                if fresh_run is not None:
                    fresh_run.status = "failed"
                    await session.commit()
        except Exception:  # noqa: BLE001
            logger.exception(
                "Failed to persist DAG workflow failure state",
                extra={"task_id": task_id, "run_id": run_id},
            )


def build_dag_summary(layers: list[list[dict]]) -> str:
    """生成面向人读的 DAG 分层概览（用于任务描述）。"""
    lines: list[str] = []
    for depth, layer in enumerate(layers, 1):
        names = [
            f"{node.get('name') or node.get('id')}({node.get('agent_role', 'agent')})"
            for node in layer
        ]
        lines.append(f"第 {depth} 层（并行）：{ '、'.join(names) }")
    return "\n".join(lines)


__all__ = [
    "DagNodeExecutionError",
    "DagWorkflowError",
    "NodeExecutor",
    "build_dag_summary",
    "default_node_executor",
    "execute_dag",
    "parse_nodes",
    "run_workflow_dag",
    "topological_sort",
]
