"""C-185: DAG 工作流引擎测试。

覆盖：
1. parse_nodes 容错；
2. topological_sort 正常分层（A→B, A→C, B/C→D）；
3. 环检测 / 未知依赖 / 缺 id 抛 ValueError；
4. 依赖不满足的节点不执行（可注入假执行器）；
5. 并行分支聚合：step 落库 node_id / order_index / dependencies_json 正确；
6. run_workflow_dag 的 WorkflowRun 生命周期（running → completed / failed）。
"""

from __future__ import annotations

import json

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models import Task, TaskStatus, Workspace
from app.models.task import TaskStep
from app.models.workflow import WorkflowRun
from app.services.dag_engine import (
    DagNodeExecutionError,
    execute_dag,
    parse_nodes,
    run_workflow_dag,
    topological_sort,
)


def _node(node_id: str, deps: list[str] | None = None, name: str | None = None) -> dict:
    return {
        "id": node_id,
        "name": name or f"节点 {node_id}",
        "agent_role": "coder",
        "prompt_template": f"执行 {node_id}",
        "dependencies": deps or [],
    }


async def _create_workspace(session_factory: async_sessionmaker) -> int:
    async with session_factory() as session:
        workspace = Workspace(name="dag-ws", description="dag tests")
        session.add(workspace)
        await session.commit()
        await session.refresh(workspace)
        return workspace.id


async def _create_task(session_factory: async_sessionmaker, workspace_id: int) -> int:
    async with session_factory() as session:
        task = Task(workspace_id=workspace_id, title="dag task", description="d")
        session.add(task)
        await session.commit()
        await session.refresh(task)
        return task.id


# ---------------------------------------------------------------------------
# parse_nodes
# ---------------------------------------------------------------------------


def test_parse_nodes_accepts_json_string_and_list() -> None:
    nodes = [_node("a"), _node("b", ["a"])]
    assert parse_nodes(json.dumps(nodes)) == nodes
    assert parse_nodes(nodes) == nodes


def test_parse_nodes_empty_returns_empty_list() -> None:
    assert parse_nodes("") == []
    assert parse_nodes([]) == []
    assert parse_nodes("   ") == []
    assert parse_nodes(None) == []


def test_parse_nodes_invalid_raises_value_error() -> None:
    with pytest.raises(ValueError):
        parse_nodes("not-json{{{")
    with pytest.raises(ValueError):
        parse_nodes({"id": "a"})  # 非数组
    with pytest.raises(ValueError):
        parse_nodes(["not-a-dict"])


# ---------------------------------------------------------------------------
# topological_sort
# ---------------------------------------------------------------------------


def test_topological_sort_layers() -> None:
    nodes = [
        _node("d", ["b", "c"]),
        _node("b", ["a"]),
        _node("a"),
        _node("c", ["a"]),
    ]
    layers = topological_sort(nodes)
    assert len(layers) == 3
    assert [n["id"] for n in layers[0]] == ["a"]
    assert sorted(n["id"] for n in layers[1]) == ["b", "c"]
    assert [n["id"] for n in layers[2]] == ["d"]


def test_topological_sort_supports_depends_on_alias() -> None:
    nodes = [{"id": "a"}, {"id": "b", "depends_on": ["a"]}]
    layers = topological_sort(nodes)
    assert [n["id"] for n in layers[0]] == ["a"]
    assert [n["id"] for n in layers[1]] == ["b"]


def test_topological_sort_cycle_raises() -> None:
    nodes = [_node("a", ["b"]), _node("b", ["a"])]
    with pytest.raises(ValueError, match="循环依赖"):
        topological_sort(nodes)


def test_topological_sort_unknown_dependency_raises() -> None:
    nodes = [_node("a", ["ghost"])]
    with pytest.raises(ValueError, match="未知"):
        topological_sort(nodes)


def test_topological_sort_missing_id_raises() -> None:
    with pytest.raises(ValueError, match="id"):
        topological_sort([{"name": "无 id 节点"}])


def test_topological_sort_duplicate_id_raises() -> None:
    with pytest.raises(ValueError, match="重复"):
        topological_sort([_node("a"), _node("a")])


def test_topological_sort_empty_nodes() -> None:
    assert topological_sort([]) == []


# ---------------------------------------------------------------------------
# execute_dag（可注入假执行器）
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def dag_task(db_session_factory: async_sessionmaker) -> Task:
    """预置工作区 + 任务，返回脱离会话的轻量载体（execute_dag 只用 task.id）。"""
    workspace_id = await _create_workspace(db_session_factory)
    task_id = await _create_task(db_session_factory, workspace_id)
    return Task(id=task_id, workspace_id=workspace_id, title="dag task")


@pytest.mark.asyncio
async def test_execute_dag_runs_all_nodes_and_persists_steps(
    db_session_factory: async_sessionmaker, dag_task: Task
) -> None:
    layers = [
        [_node("a"), _node("b")],
        [_node("c", ["a", "b"])],
    ]
    executed: list[str] = []

    async def fake_executor(session: AsyncSession, task: Task, node: dict):
        executed.append(node["id"])
        return None, f"out-{node['id']}"

    outputs = await execute_dag(
        layers, task=dag_task, session_factory=db_session_factory, executor=fake_executor
    )
    assert executed == ["a", "b", "c"]
    assert outputs == {"a": "out-a", "b": "out-b", "c": "out-c"}

    async with db_session_factory() as session:
        steps = list(
            await session.scalars(
                select(TaskStep)
                .where(TaskStep.task_id == dag_task.id)
                .order_by(TaskStep.order_index)
            )
        )
    assert [s.node_id for s in steps] == ["a", "b", "c"]
    assert [s.order_index for s in steps] == [0, 1, 2]
    assert all(s.status == "completed" for s in steps)
    assert steps[0].dependencies_json == "[]"
    assert json.loads(steps[2].dependencies_json) == ["a", "b"]
    assert steps[2].output == "out-c"


@pytest.mark.asyncio
async def test_execute_dag_aborts_downstream_on_failure(
    db_session_factory: async_sessionmaker, dag_task: Task
) -> None:
    layers = [
        [_node("a")],
        [_node("b", ["a"]), _node("c", ["a"])],
        [_node("d", ["b", "c"])],
    ]
    executed: list[str] = []

    async def fake_executor(session: AsyncSession, task: Task, node: dict):
        executed.append(node["id"])
        if node["id"] == "b":
            raise RuntimeError("节点 b 爆炸")
        return None, f"out-{node['id']}"

    with pytest.raises(DagNodeExecutionError) as exc_info:
        await execute_dag(
            layers, task=dag_task, session_factory=db_session_factory, executor=fake_executor
        )
    assert exc_info.value.node_id == "b"
    # a 全层执行；同层 c 不受 b 失败影响；下游 d（依赖不满足）绝不执行
    assert executed == ["a", "b", "c"]

    async with db_session_factory() as session:
        steps = {
            s.node_id: s
            for s in await session.scalars(
                select(TaskStep).where(TaskStep.task_id == dag_task.id)
            )
        }
    assert set(steps) == {"a", "b", "c"}
    assert steps["b"].status == "failed"
    assert "爆炸" in (steps["b"].output or "")
    assert steps["b"].order_index == 1


@pytest.mark.asyncio
async def test_execute_dag_node_failure_recorded_before_abort(
    db_session_factory: async_sessionmaker, dag_task: Task
) -> None:
    layers = [[_node("a")], [_node("b", ["a"])]]

    async def fake_executor(session: AsyncSession, task: Task, node: dict):
        if node["id"] == "b":
            raise RuntimeError("boom")
        return None, "out-a"

    with pytest.raises(DagNodeExecutionError):
        await execute_dag(
            layers, task=dag_task, session_factory=db_session_factory, executor=fake_executor
        )

    async with db_session_factory() as session:
        steps = list(
            await session.scalars(
                select(TaskStep)
                .where(TaskStep.task_id == dag_task.id)
                .order_by(TaskStep.order_index)
            )
        )
    assert [(s.node_id, s.status) for s in steps] == [("a", "completed"), ("b", "failed")]


# ---------------------------------------------------------------------------
# run_workflow_dag：WorkflowRun 生命周期 + 任务终态
# ---------------------------------------------------------------------------


async def _create_run(
    session_factory: async_sessionmaker, layers: list[list[dict]]
) -> tuple[int, int]:
    workspace_id = await _create_workspace(session_factory)
    async with session_factory() as session:
        task = Task(workspace_id=workspace_id, title="run task", description="d")
        session.add(task)
        await session.commit()
        await session.refresh(task)
        run = WorkflowRun(
            template_id=1,
            task_id=task.id,
            status="running",
            snapshot_nodes_json=json.dumps([n for layer in layers for n in layer]),
        )
        session.add(run)
        await session.commit()
        await session.refresh(run)
        return task.id, run.id


@pytest.mark.asyncio
async def test_run_workflow_dag_completes(db_session_factory: async_sessionmaker) -> None:
    layers = [[_node("a")], [_node("b", ["a"])]]
    task_id, run_id = await _create_run(db_session_factory, layers)

    async def fake_executor(session: AsyncSession, task: Task, node: dict):
        return None, f"out-{node['id']}"

    await run_workflow_dag(
        task_id,
        run_id,
        layers,
        session_factory=db_session_factory,
        executor=fake_executor,
    )

    async with db_session_factory() as session:
        task = await session.get(Task, task_id)
        run = await session.get(WorkflowRun, run_id)
    assert task is not None and task.status == TaskStatus.COMPLETED
    assert "out-b" in (task.result or "")
    assert run is not None and run.status == "completed"


@pytest.mark.asyncio
async def test_run_workflow_dag_marks_failed_and_aborts(
    db_session_factory: async_sessionmaker,
) -> None:
    layers = [[_node("a")], [_node("b", ["a"])]]
    task_id, run_id = await _create_run(db_session_factory, layers)

    async def fake_executor(session: AsyncSession, task: Task, node: dict):
        if node["id"] == "b":
            raise RuntimeError("下游失败")
        return None, "out-a"

    await run_workflow_dag(
        task_id,
        run_id,
        layers,
        session_factory=db_session_factory,
        executor=fake_executor,
    )

    async with db_session_factory() as session:
        task = await session.get(Task, task_id)
        run = await session.get(WorkflowRun, run_id)
        steps = {
            s.node_id: s
            for s in await session.scalars(
                select(TaskStep).where(TaskStep.task_id == task_id)
            )
        }
    assert task is not None and task.status == TaskStatus.FAILED
    assert run is not None and run.status == "failed"
    assert set(steps) == {"a", "b"}
    assert steps["b"].status == "failed"


# ---------------------------------------------------------------------------
# C-184 × C-185 集成：DAG 中的 human_approval 节点
# ---------------------------------------------------------------------------


def _approval_node(node_id: str, deps: list[str] | None = None) -> dict:
    node = _node(node_id, deps)
    node["type"] = "human_approval"
    node["agent_role"] = ""
    node["prompt_template"] = ""
    node["description"] = "请审批本阶段产出"
    return node


async def _approve_waiting_step(
    session_factory: async_sessionmaker, task_id: int, final_status: str
) -> None:
    """模拟人工操作：等 waiting 步骤出现后置为 approved/rejected。"""
    import asyncio as _asyncio

    for _ in range(200):
        await _asyncio.sleep(0.02)
        async with session_factory() as session:
            step = await session.scalar(
                select(TaskStep).where(
                    TaskStep.task_id == task_id,
                    TaskStep.step_name == "human_approval",
                    TaskStep.status == "waiting",
                )
            )
            if step is not None:
                step.status = final_status
                session.add(step)
                await session.commit()
                return
    raise AssertionError("waiting human_approval step never appeared")


@pytest.mark.asyncio
async def test_dag_human_approval_node_approved_continues(
    db_session_factory: async_sessionmaker,
    dag_task: Task,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import asyncio

    from app.services import dag_engine as dag_engine_module

    monkeypatch.setattr(dag_engine_module, "APPROVAL_POLL_INTERVAL_SECONDS", 0.01)
    layers = [[_node("a")], [_approval_node("gate", ["a"])], [_node("final", ["gate"])]]
    executed: list[str] = []

    async def fake_executor(session: AsyncSession, task: Task, node: dict):
        executed.append(node["id"])
        return None, f"out-{node['id']}"

    approver = asyncio.create_task(
        _approve_waiting_step(db_session_factory, dag_task.id, "approved")
    )
    outputs = await execute_dag(
        layers, task=dag_task, session_factory=db_session_factory, executor=fake_executor
    )
    await approver

    assert executed == ["a", "final"]
    assert outputs["gate"] == "人工审批通过"
    assert outputs["final"] == "out-final"

    async with db_session_factory() as session:
        steps = {
            s.node_id: s
            for s in await session.scalars(
                select(TaskStep).where(TaskStep.task_id == dag_task.id)
            )
        }
        task = await session.get(Task, dag_task.id)
    assert steps["gate"].status == "approved"
    assert steps["gate"].step_name == "human_approval"
    assert steps["gate"].node_id == "gate"
    # 审批通过后任务被审批分支置回 RUNNING（供后续层/终态推进）
    assert task is not None and task.status == TaskStatus.RUNNING


@pytest.mark.asyncio
async def test_dag_human_approval_node_rejected_aborts(
    db_session_factory: async_sessionmaker,
    dag_task: Task,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import asyncio

    from app.services import dag_engine as dag_engine_module

    monkeypatch.setattr(dag_engine_module, "APPROVAL_POLL_INTERVAL_SECONDS", 0.01)
    layers = [[_node("a")], [_approval_node("gate", ["a"])], [_node("final", ["gate"])]]
    executed: list[str] = []

    async def fake_executor(session: AsyncSession, task: Task, node: dict):
        executed.append(node["id"])
        return None, f"out-{node['id']}"

    rejecter = asyncio.create_task(
        _approve_waiting_step(db_session_factory, dag_task.id, "rejected")
    )
    with pytest.raises(DagNodeExecutionError) as exc_info:
        await execute_dag(
            layers,
            task=dag_task,
            session_factory=db_session_factory,
            executor=fake_executor,
        )
    await rejecter

    assert exc_info.value.node_id == "gate"
    assert executed == ["a"]  # 下游 final 不执行

    async with db_session_factory() as session:
        steps = {
            s.node_id: s
            for s in await session.scalars(
                select(TaskStep).where(TaskStep.task_id == dag_task.id)
            )
        }
        task = await session.get(Task, dag_task.id)
    assert steps["gate"].status == "rejected"
    assert "人工驳回" in (steps["gate"].output or "")
    assert "final" not in steps
    assert task is not None and task.status == TaskStatus.FAILED
