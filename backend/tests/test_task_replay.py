"""任务回放 / 从失败步骤恢复的契约测试。

P0 修复后本文件锁住以下行为：
- 回放帧携带失败步骤的 error_message（不再恒为 None）；
- resume-from-step 真正把任务重新入队 / 派发（而不是只改状态）；
- 队列死信项被复活（attempt_count 归零）；
- JWT 跨工作区访问回放 / 恢复被拒绝（403）；
- 静态 token 模式下无凭据请求被中间件拒绝（401）。
"""

import asyncio
from collections.abc import Iterator
from datetime import datetime, timezone
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.config import get_settings
from app.db.base import Base
from app.db.session import get_db
from app.main import app
from app.models.enums import TaskStatus
from app.models.task import Task, TaskStep
from app.models.task_queue import TaskQueueItem
from app.models.workspace import Workspace


@pytest.fixture
def replay_client(tmp_path) -> Iterator[TestClient]:
    database_path = tmp_path / "replay-test.db"
    engine = create_async_engine(f"sqlite+aiosqlite:///{database_path.as_posix()}")
    session_factory = async_sessionmaker(engine, expire_on_commit=False)

    async def create_schema_and_task() -> tuple[int, int]:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)

        async with session_factory() as session:
            ws = Workspace(name="Replay WS", description="Replay Workspace")
            session.add(ws)
            await session.commit()
            await session.refresh(ws)

            task = Task(
                workspace_id=ws.id,
                title="Test Task for Replay",
                description="Test prompt",
                status=TaskStatus.FAILED,
            )
            session.add(task)
            await session.commit()
            await session.refresh(task)

            now = datetime.now(timezone.utc)
            step1 = TaskStep(
                task_id=task.id,
                step_name="manager_plan",
                status="completed",
                input='{"prompt": "Test prompt"}',
                output='{"plan": ["step1", "step2"]}',
                started_at=now,
                finished_at=now,
            )
            step2 = TaskStep(
                task_id=task.id,
                step_name="worker_execute_1",
                status="failed",
                input='{"instruction": "write code"}',
                output="boom: model call failed",
                started_at=now,
                finished_at=now,
            )
            session.add_all([step1, step2])
            await session.commit()
            await session.refresh(step2)
            return task.id, step2.id

    task_id, step2_id = asyncio.run(create_schema_and_task())

    async def override_get_db():
        async with session_factory() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    try:
        with TestClient(app) as client:
            client.test_task_id = task_id
            client.test_step_id = step2_id
            client.test_session_factory = session_factory
            yield client
    finally:
        app.dependency_overrides.clear()
        asyncio.run(engine.dispose())


def _session_run(client: TestClient, coro_factory):
    async def runner():
        async with client.test_session_factory() as session:
            return await coro_factory(session)

    return asyncio.run(runner())


async def _get_task(session, task_id: int) -> Task:
    return await session.get(Task, task_id)


async def _get_step(session, step_id: int) -> TaskStep:
    return await session.get(TaskStep, step_id)


async def _get_queue_item(session, task_id: int) -> TaskQueueItem:
    return await session.scalar(
        select(TaskQueueItem).where(TaskQueueItem.task_id == task_id)
    )


def test_task_replay_flow_reports_failure_reason(replay_client: TestClient) -> None:
    task_id = replay_client.test_task_id

    res = replay_client.get(f"/api/v1/tasks/{task_id}/replay")
    assert res.status_code == 200
    data = res.json()["data"]
    assert data["task_id"] == task_id
    assert len(data["frames"]) == 2
    assert data["frames"][0]["step_name"] == "manager_plan"
    assert data["frames"][0]["error_message"] is None
    assert data["frames"][1]["status"] == "failed"
    # P0-6：失败步骤必须携带错误文本（此前恒为 None）。
    assert data["frames"][1]["error_message"] == "boom: model call failed"


def test_resume_from_step_requeues_dead_item_and_dispatches(
    replay_client: TestClient,
) -> None:
    """resume 必须真正重新调度：复活死信队列项并触发执行派发。"""
    task_id = replay_client.test_task_id
    step2_id = replay_client.test_step_id

    async def seed_dead_item(session) -> None:
        session.add(
            TaskQueueItem(
                task_id=task_id,
                status="dead",
                attempt_count=3,
                max_attempts=3,
                last_error="previous failure",
            )
        )
        await session.commit()

    _session_run(replay_client, seed_dead_item)

    with patch(
        "app.api.v1.endpoints.task_replay.dispatch_background_task"
    ) as dispatch_mock:
        resume_res = replay_client.post(
            f"/api/v1/tasks/{task_id}/resume-from-step",
            json={"step_id": step2_id, "custom_instruction": "Retry with fix"},
        )

    assert resume_res.status_code == 200, resume_res.text
    resume_data = resume_res.json()["data"]
    assert resume_data["status"] == "pending"
    assert resume_data["resumed_step_id"] == step2_id
    assert "重新调度" in resume_data["message"]

    # 真实派发（inline 模式），而不是只改状态。
    dispatch_mock.assert_called_once_with(task_id)

    # 队列死信项被复活为可认领状态，且重试计数归零。
    item = _session_run(replay_client, lambda s: _get_queue_item(s, task_id))
    assert item is not None
    assert item.status == "queued"
    assert item.attempt_count == 0
    assert item.lease_token is None

    # 任务与步骤回到可执行状态；恢复指令进入任务描述供执行体读取。
    task = _session_run(replay_client, lambda s: _get_task(s, task_id))
    step = _session_run(replay_client, lambda s: _get_step(s, step2_id))
    assert task.status == TaskStatus.PENDING
    assert step.status == "pending"
    assert step.finished_at is None
    assert "Retry with fix" in (task.description or "")
    assert "【恢复指令】" in (task.description or "")


def test_resume_from_step_rejects_completed_step(replay_client: TestClient) -> None:
    task_id = replay_client.test_task_id

    # step1 是 completed，不允许"恢复"。
    frames = replay_client.get(f"/api/v1/tasks/{task_id}/replay").json()["data"]["frames"]
    completed_step_id = next(f["step_id"] for f in frames if f["status"] == "completed")

    res = replay_client.post(
        f"/api/v1/tasks/{task_id}/resume-from-step",
        json={"step_id": completed_step_id},
    )
    assert res.status_code == 409
    assert "已完成" in res.json()["error"]


def test_resume_from_step_rejects_running_task(replay_client: TestClient) -> None:
    task_id = replay_client.test_task_id
    step2_id = replay_client.test_step_id

    async def mark_running(session) -> None:
        task = await session.get(Task, task_id)
        task.status = TaskStatus.RUNNING
        await session.commit()

    _session_run(replay_client, mark_running)
    try:
        res = replay_client.post(
            f"/api/v1/tasks/{task_id}/resume-from-step",
            json={"step_id": step2_id},
        )
        assert res.status_code == 409
    finally:
        async def mark_failed(session) -> None:
            task = await session.get(Task, task_id)
            task.status = TaskStatus.FAILED
            await session.commit()

        _session_run(replay_client, mark_failed)


def test_replay_rejects_cross_workspace_jwt(replay_client: TestClient) -> None:
    """JWT 调用方访问非成员工作区的任务回放 / 恢复必须 403。"""
    owner_res = replay_client.post(
        "/api/v1/auth/register",
        json={
            "email": "owner@example.com",
            "password": "Password123!",
            "display_name": "Owner",
        },
    )
    assert owner_res.status_code == 200, owner_res.text
    owner_token = owner_res.json()["data"]["access_token"]

    member_res = replay_client.post(
        "/api/v1/auth/register",
        json={
            "email": "member@example.com",
            "password": "Password123!",
            "display_name": "Member",
        },
    )
    assert member_res.status_code == 200, member_res.text
    member_token = member_res.json()["data"]["access_token"]

    async def create_foreign_task(session) -> int:
        ws = Workspace(name="Foreign WS", description="no members")
        session.add(ws)
        await session.flush()
        task = Task(
            workspace_id=ws.id,
            title="Foreign task",
            description="not accessible",
            status=TaskStatus.FAILED,
        )
        session.add(task)
        await session.commit()
        return task.id

    foreign_task_id = _session_run(replay_client, create_foreign_task)
    headers = {"Authorization": f"Bearer {member_token}"}

    read_res = replay_client.get(
        f"/api/v1/tasks/{foreign_task_id}/replay", headers=headers
    )
    assert read_res.status_code == 403

    resume_res = replay_client.post(
        f"/api/v1/tasks/{foreign_task_id}/resume-from-step",
        json={"step_id": replay_client.test_step_id},
        headers=headers,
    )
    assert resume_res.status_code == 403

    # owner 也不是该工作区成员，同样被拒绝。
    owner_read = replay_client.get(
        f"/api/v1/tasks/{foreign_task_id}/replay",
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    assert owner_read.status_code == 403


def test_replay_requires_credentials_when_static_token_configured(
    replay_client: TestClient,
) -> None:
    task_id = replay_client.test_task_id
    settings = get_settings()
    original = settings.app_api_token
    settings.app_api_token = SecretStr("static-dev-token")
    try:
        res = replay_client.get(f"/api/v1/tasks/{task_id}/replay")
        assert res.status_code == 401

        ok = replay_client.get(
            f"/api/v1/tasks/{task_id}/replay",
            headers={"Authorization": "Bearer static-dev-token"},
        )
        assert ok.status_code == 200
    finally:
        settings.app_api_token = original
