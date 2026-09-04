"""Tests for the HITL human approval node (C-184).

Covers the multi-agent orchestrator suspension point (WAITING_APPROVAL
between review and final), the DB-polling resume path driven by another
session, and the approve/reject API endpoints including the 409 guard.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
from collections.abc import Iterator
from unittest.mock import AsyncMock, patch

import pytest
import pytest_asyncio
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncEngine, async_sessionmaker, create_async_engine

from app.core.orchestrator import HUMAN_APPROVAL_STEP_NAME, AgentOrchestrator
from app.db.base import Base
from app.db.session import get_db
from app.main import app
from app.models import (
    Agent,
    Conversation,
    Task,
    TaskStatus,
    TaskStep,
    WorkflowTemplate,
    Workspace,
)
from app.services.litellm_service import ChatCompletionResult, TokenUsage


class RecordingBroadcaster:
    def __init__(self) -> None:
        self.events: list[tuple[int, dict]] = []

    async def broadcast_to_workspace(self, workspace_id: int, event: dict) -> None:
        self.events.append((workspace_id, event))


def completion(content: str, model_name: str) -> ChatCompletionResult:
    return ChatCompletionResult(
        content=content,
        usage=TokenUsage(prompt_tokens=8, completion_tokens=3, total_tokens=11),
        provider="test",
        model_name=f"test/{model_name}",
        requested_model=model_name,
        latency_ms=15,
        fallback_used=False,
    )


PLAN_JSON = json.dumps(
    {
        "task_summary": "实现 API",
        "subtasks": [
            {
                "id": 1,
                "title": "实现 API",
                "description": "实现并验证接口",
                "task_type": "backend",
                "agent": "Agent工程师",
            }
        ],
    },
    ensure_ascii=False,
)

COMPLETIONS = [
    completion(PLAN_JSON, "manager_model"),
    completion("API 已实现并包含参数校验。", "code_model"),
    completion("结论：通过。", "review_model"),
    completion("功能已完成。", "manager_model"),
]


async def create_multi_agent_graph(
    session,
    *,
    description: str = "@项目总设计师 实现一个带 API 的响应式管理页面。",
) -> tuple[dict[str, Agent], Task]:
    workspace = Workspace(name="Approval workspace", description="tests")
    conversation = Conversation(workspace=workspace, title="Approval chat")
    session.add_all([workspace, conversation])
    await session.flush()

    definitions = [
        ("项目总设计师", "project_architect", "manager_model"),
        ("Agent工程师", "agent_engineer", "code_model"),
        ("测试专员", "qa_engineer", "review_model"),
    ]
    agents = {
        name: Agent(
            workspace_id=workspace.id,
            name=name,
            role=role,
            model_name=model_name,
            system_prompt=f"System prompt for {name}",
            status="idle",
        )
        for name, role, model_name in definitions
    }
    session.add_all(agents.values())
    await session.flush()

    task = Task(
        workspace_id=workspace.id,
        conversation_id=conversation.id,
        title="Build feature",
        description=description,
        assigned_agent_id=agents["项目总设计师"].id,
        status=TaskStatus.PENDING,
    )
    session.add(task)
    await session.commit()
    return agents, task


@pytest_asyncio.fixture
async def approval_env(tmp_path) -> AsyncIterator[async_sessionmaker]:
    """A throwaway engine + session factory shared by orchestrator and poller."""
    database_path = tmp_path / "human-approval-test.db"
    engine: AsyncEngine = create_async_engine(
        f"sqlite+aiosqlite:///{database_path.as_posix()}"
    )
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    yield session_factory
    await engine.dispose()


@pytest.fixture
def fast_poll(monkeypatch) -> None:
    """把审批轮询间隔压到极小值，验证跨 session 轮询路径。"""
    monkeypatch.setattr(
        "app.core.orchestrator.APPROVAL_POLL_INTERVAL_SECONDS", 0.01
    )


async def wait_for_task_status(
    session_factory: async_sessionmaker,
    task_id: int,
    expected: TaskStatus,
    timeout: float = 5.0,
) -> None:
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout
    while loop.time() < deadline:
        async with session_factory() as session:
            status = await session.scalar(
                select(Task.status).where(Task.id == task_id)
            )
        if status == expected:
            return
        await asyncio.sleep(0.02)
    raise AssertionError(f"Task {task_id} did not reach {expected} in time")


async def latest_approval_step(
    session_factory: async_sessionmaker, task_id: int
) -> TaskStep | None:
    async with session_factory() as session:
        return await session.scalar(
            select(TaskStep)
            .where(
                TaskStep.task_id == task_id,
                TaskStep.step_name == HUMAN_APPROVAL_STEP_NAME,
            )
            .order_by(TaskStep.id.desc())
            .limit(1)
        )


def start_orchestrator(
    session_factory: async_sessionmaker,
    task_id: int,
    *,
    use_run_task: bool = False,
) -> asyncio.Task:
    async def run():
        # 补丁需覆盖后台协程的完整生命周期，因此在 run() 内进入上下文。
        with patch(
            "app.services.litellm_service.chat_completion",
            new=AsyncMock(side_effect=list(COMPLETIONS)),
        ):
            async with session_factory() as session:
                orchestrator = AgentOrchestrator(
                    session,
                    RecordingBroadcaster(),
                    approval_session_factory=session_factory,
                )
                if use_run_task:
                    return await orchestrator.run_task(task_id)
                task = await session.get(Task, task_id)
                manager = await session.get(Agent, task.assigned_agent_id)
                return await orchestrator._run_multi_agent_task(
                    task, manager, requires_approval=True
                )

    return asyncio.create_task(run())


@pytest.mark.asyncio
async def test_multi_agent_task_suspends_on_waiting_approval(
    approval_env, fast_poll
) -> None:
    """到审批点挂起：任务 WAITING_APPROVAL 且存在 human_approval/waiting 步骤。"""
    session_factory = approval_env
    async with session_factory() as session:
        _, task = await create_multi_agent_graph(session)
        task_id = task.id

    runner = start_orchestrator(session_factory, task_id)
    try:
        await wait_for_task_status(
            session_factory, task_id, TaskStatus.WAITING_APPROVAL
        )
        step = await latest_approval_step(session_factory, task_id)
        assert step is not None
        assert step.status == "waiting"
        async with session_factory() as session:
            step_names = (
                await session.scalars(
                    select(TaskStep.step_name)
                    .where(TaskStep.task_id == task_id)
                    .order_by(TaskStep.id)
                )
            ).all()
        # 审批步骤落在 review 之后、final 之前
        assert step_names.index(HUMAN_APPROVAL_STEP_NAME) == len(step_names) - 1
        assert "final_summary" not in step_names
    finally:
        runner.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await runner


@pytest.mark.asyncio
async def test_approval_resume_completes_task(approval_env, fast_poll) -> None:
    """另一 session 写库 approved 后，挂起方经 DB 轮询观察到并继续到 COMPLETED。"""
    session_factory = approval_env
    async with session_factory() as session:
        _, task = await create_multi_agent_graph(session)
        task_id = task.id

    runner = start_orchestrator(session_factory, task_id)
    try:
        await wait_for_task_status(
            session_factory, task_id, TaskStatus.WAITING_APPROVAL
        )
        async with session_factory() as session:
            step = await session.scalar(
                select(TaskStep)
                .where(
                    TaskStep.task_id == task_id,
                    TaskStep.step_name == HUMAN_APPROVAL_STEP_NAME,
                    TaskStep.status == "waiting",
                )
                .order_by(TaskStep.id.desc())
                .limit(1)
            )
            assert step is not None
            step.status = "approved"
            await session.commit()

        result = await asyncio.wait_for(runner, timeout=10)
        assert result.status == TaskStatus.COMPLETED
        approved_step = await latest_approval_step(session_factory, task_id)
        assert approved_step is not None
        assert approved_step.status == "approved"
        async with session_factory() as session:
            step_names = (
                await session.scalars(
                    select(TaskStep.step_name)
                    .where(TaskStep.task_id == task_id)
                    .order_by(TaskStep.id)
                )
            ).all()
        assert step_names == [
            "manager_plan",
            "worker_execute_1",
            "review_results",
            HUMAN_APPROVAL_STEP_NAME,
            "final_summary",
        ]
    except BaseException:
        runner.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await runner
        raise


@pytest.mark.asyncio
async def test_rejection_fails_task(approval_env, fast_poll) -> None:
    """另一 session 写库 rejected 后，任务置 FAILED 且步骤为 rejected。"""
    session_factory = approval_env
    async with session_factory() as session:
        _, task = await create_multi_agent_graph(session)
        task_id = task.id

    runner = start_orchestrator(session_factory, task_id)
    try:
        await wait_for_task_status(
            session_factory, task_id, TaskStatus.WAITING_APPROVAL
        )
        async with session_factory() as session:
            step = await session.scalar(
                select(TaskStep)
                .where(
                    TaskStep.task_id == task_id,
                    TaskStep.step_name == HUMAN_APPROVAL_STEP_NAME,
                    TaskStep.status == "waiting",
                )
                .order_by(TaskStep.id.desc())
                .limit(1)
            )
            assert step is not None
            step.status = "rejected"
            await session.commit()

        result = await asyncio.wait_for(runner, timeout=10)
        assert result.status == TaskStatus.FAILED
        assert "人工驳回" in (result.result or "")
        rejected_step = await latest_approval_step(session_factory, task_id)
        assert rejected_step is not None
        assert rejected_step.status == "rejected"
        async with session_factory() as session:
            step_names = (
                await session.scalars(
                    select(TaskStep.step_name)
                    .where(TaskStep.task_id == task_id)
                    .order_by(TaskStep.id)
                )
            ).all()
        assert "final_summary" not in step_names
    except BaseException:
        runner.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await runner
        raise


@pytest.mark.asyncio
async def test_run_task_detects_human_approval_from_workflow_template(
    approval_env, fast_poll
) -> None:
    """run_task 入口按描述头反查工作流模板，含 human_approval 节点即挂起。"""
    session_factory = approval_env
    async with session_factory() as session:
        _, task = await create_multi_agent_graph(
            session,
            description="【执行工作流流水线：审批流水线】\n\n实现一个 API。",
        )
        task_id = task.id
        session.add(
            WorkflowTemplate(
                workspace_id=task.workspace_id,
                name="approval-pipeline",
                display_name="审批流水线",
                nodes_json=json.dumps(
                    [
                        {
                            "id": "n1",
                            "name": "人工审批",
                            "agent_role": "reviewer",
                            "prompt_template": "",
                            "type": "human_approval",
                        }
                    ]
                ),
                is_system=False,
            )
        )
        await session.commit()

    runner = start_orchestrator(session_factory, task_id, use_run_task=True)
    try:
        await wait_for_task_status(
            session_factory, task_id, TaskStatus.WAITING_APPROVAL
        )
        step = await latest_approval_step(session_factory, task_id)
        assert step is not None
        assert step.status == "waiting"
    finally:
        runner.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await runner


# ---------------------------------------------------------------------------
# API endpoints
# ---------------------------------------------------------------------------


@pytest.fixture
def approval_api(tmp_path) -> Iterator[tuple[TestClient, async_sessionmaker]]:
    database_path = tmp_path / "approval-api-test.db"
    engine = create_async_engine(f"sqlite+aiosqlite:///{database_path.as_posix()}")
    session_factory = async_sessionmaker(engine, expire_on_commit=False)

    async def create_schema() -> None:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)

    async def override_get_db():
        async with session_factory() as session:
            yield session

    asyncio.run(create_schema())
    app.dependency_overrides[get_db] = override_get_db
    try:
        with patch("app.core.message_hub.dispatch_background_task"):
            with TestClient(app) as client:
                yield client, session_factory
    finally:
        app.dependency_overrides.clear()
        asyncio.run(engine.dispose())


def seed_waiting_approval(session_factory: async_sessionmaker, task_id: int) -> None:
    async def seed() -> None:
        async with session_factory() as session:
            task = await session.get(Task, task_id)
            task.status = TaskStatus.WAITING_APPROVAL
            session.add(
                TaskStep(
                    task_id=task_id,
                    step_name=HUMAN_APPROVAL_STEP_NAME,
                    status="waiting",
                )
            )
            await session.commit()

    asyncio.run(seed())


def fetch_latest_approval_step(
    session_factory: async_sessionmaker, task_id: int
) -> TaskStep | None:
    async def fetch() -> TaskStep | None:
        async with session_factory() as session:
            return (
                await session.scalars(
                    select(TaskStep)
                    .where(
                        TaskStep.task_id == task_id,
                        TaskStep.step_name == HUMAN_APPROVAL_STEP_NAME,
                    )
                    .order_by(TaskStep.id.desc())
                    .limit(1)
                )
            ).first()

    return asyncio.run(fetch())


def test_approval_api_approve_and_reject_flow(approval_api) -> None:
    """approve 后任务回 RUNNING、步骤 approved；reject 后任务 FAILED。"""
    client, session_factory = approval_api

    def create_task(title: str) -> int:
        workspace = client.post(
            "/api/workspaces",
            json={"name": f"Approval WS {title}", "description": "tests"},
        ).json()["data"]
        return client.post(
            "/api/tasks",
            json={"workspace_id": workspace["id"], "title": title},
        ).json()["data"]["id"]

    # --- approve ---
    task_id = create_task("审批通过任务")
    seed_waiting_approval(session_factory, task_id)
    approved = client.post(f"/api/tasks/{task_id}/approve")
    assert approved.status_code == 200, approved.text
    assert approved.json()["data"]["status"] == "running"
    step = fetch_latest_approval_step(session_factory, task_id)
    assert step is not None
    assert step.status == "approved"
    # 任务已回 RUNNING，再次审批应 409
    assert client.post(f"/api/tasks/{task_id}/approve").status_code == 409

    # --- reject ---
    task_id = create_task("审批驳回任务")
    seed_waiting_approval(session_factory, task_id)
    rejected = client.post(f"/api/tasks/{task_id}/reject")
    assert rejected.status_code == 200, rejected.text
    body = rejected.json()["data"]
    assert body["status"] == "failed"
    assert "人工驳回" in (body["result"] or "")
    step = fetch_latest_approval_step(session_factory, task_id)
    assert step is not None
    assert step.status == "rejected"


def test_approval_api_rejects_non_waiting_task(approval_api) -> None:
    """非 WAITING_APPROVAL 状态调 approve/reject 返回 409。"""
    client, _ = approval_api
    workspace = client.post(
        "/api/workspaces",
        json={"name": "Guard WS", "description": "tests"},
    ).json()["data"]
    task = client.post(
        "/api/tasks",
        json={"workspace_id": workspace["id"], "title": "Guard task"},
    ).json()["data"]

    approve = client.post(f"/api/tasks/{task['id']}/approve")
    reject = client.post(f"/api/tasks/{task['id']}/reject")
    assert approve.status_code == 409
    assert reject.status_code == 409
    assert "waiting for approval" in approve.json()["error"]
