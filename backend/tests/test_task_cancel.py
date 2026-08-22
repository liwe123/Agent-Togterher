"""Tests for task cancellation, external-execution cancel and orphan recovery (P2)."""

from __future__ import annotations

import asyncio
import json
from collections.abc import Iterator
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base, utc_now
from app.db.session import get_db
from app.main import app
from app.models import IntegrationNode, Task, TaskStep, Workspace
from app.models.enums import TaskStatus


@pytest.fixture
def client(tmp_path) -> Iterator[TestClient]:
    database_path = tmp_path / "cancel-test.db"
    engine = create_async_engine(f"sqlite+aiosqlite:///{database_path.as_posix()}")
    session_factory = async_sessionmaker(engine, expire_on_commit=False)

    async def create_schema() -> None:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)

    async def override_get_db():
        async with session_factory() as session:
            yield session

    import asyncio

    asyncio.run(create_schema())
    app.dependency_overrides[get_db] = override_get_db
    try:
        with TestClient(app) as test_client:
            yield test_client
    finally:
        app.dependency_overrides.clear()
        asyncio.run(engine.dispose())


def _post(client: TestClient, path: str, json_body: dict | None = None):
    response = client.post(path, json=json_body or {})
    assert response.status_code < 500, response.text
    return response


def make_workspace_and_task(client: TestClient) -> tuple[int, dict]:
    ws = client.post(
        "/api/workspaces", json={"name": "cancel-ws", "description": "t"}
    ).json()["data"]
    task = client.post(
        "/api/tasks",
        json={"workspace_id": ws["id"], "title": "t", "description": "d"},
    ).json()["data"]
    return ws["id"], task


def test_cancel_pending_task(client: TestClient) -> None:
    _, task = make_workspace_and_task(client)
    response = _post(client, f"/api/tasks/{task['id']}/cancel")
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert data["status"] == "cancelled"


def test_cancel_terminal_task_conflict(client: TestClient) -> None:
    _, task = make_workspace_and_task(client)
    assert _post(client, f"/api/tasks/{task['id']}/cancel").status_code == 200
    response = _post(client, f"/api/tasks/{task['id']}/cancel")
    assert response.status_code == 409


@pytest.mark.asyncio
async def test_waiting_approval_status_round_trip(db_session) -> None:
    session = db_session
    workspace = Workspace(name="wa-ws", description="wa")
    session.add(workspace)
    await session.flush()
    task = Task(
        workspace_id=workspace.id,
        title="waiting",
        description="d",
        status=TaskStatus.WAITING_APPROVAL,
    )
    session.add(task)
    await session.commit()

    from sqlalchemy import select

    found = await session.scalar(
        select(Task).where(
            Task.workspace_id == workspace.id,
            Task.status == TaskStatus.WAITING_APPROVAL,
        )
    )
    assert found is not None
    assert found.id == task.id
    assert found.status == TaskStatus.WAITING_APPROVAL


@pytest.mark.asyncio
async def test_cancel_external_execution_marks_step_and_marker(tmp_path, monkeypatch):
    from app.services.integration_service import (
        cancel_external_execution,
        register_cancel_event,
    )

    monkeypatch.setattr(
        "app.services.integration_service.get_settings",
        lambda: type("S", (), {"bridge_root_dir": str(tmp_path)})(),
    )

    engine = create_async_engine(f"sqlite+aiosqlite:///{(tmp_path / 'c.db').as_posix()}")
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    async with factory() as session:
        workspace = Workspace(name="ws", description="ws")
        session.add(workspace)
        await session.flush()
        task = Task(
            workspace_id=workspace.id,
            title="external",
            description="d",
            status=TaskStatus.RUNNING,
        )
        session.add(task)
        await session.flush()
        node = IntegrationNode(
            workspace_id=workspace.id,
            name="codex-node",
            provider="codex",
            mode="cli",
            status="online",
            current_task_count=1,
            max_concurrency=2,
        )
        session.add(node)
        await session.flush()
        step = TaskStep(
            task_id=task.id,
            step_name="integration_dispatch:codex:codex-node",
            input=json.dumps({"node_id": node.id, "node_name": node.name}),
            status="running",
            started_at=utc_now(),
        )
        session.add(step)
        await session.commit()

        cancel_event = register_cancel_event(task.id)

        note = await cancel_external_execution(session, task)

        assert note is not None
        assert "codex-node" in note
        assert cancel_event.is_set()
        marker = (
            tmp_path
            / f"workspace-{workspace.id}"
            / "codex-node"
            / f"task-{task.id}"
            / "CANCELLED"
        )
        assert marker.exists()
        await session.refresh(step)
        assert step.status == "failed"

    await engine.dispose()


@pytest.mark.asyncio
async def test_recover_orphan_integration_steps(tmp_path):
    from app.services.integration_service import recover_orphan_integration_steps

    engine = create_async_engine(f"sqlite+aiosqlite:///{(tmp_path / 'o.db').as_posix()}")
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    async with factory() as session:
        workspace = Workspace(name="ws", description="ws")
        session.add(workspace)
        await session.flush()
        orphan_task = Task(
            workspace_id=workspace.id,
            title="orphan",
            description="d",
            status=TaskStatus.RUNNING,
        )
        fresh_task = Task(
            workspace_id=workspace.id,
            title="fresh",
            description="d",
            status=TaskStatus.RUNNING,
        )
        internal_task = Task(
            workspace_id=workspace.id,
            title="internal",
            description="d",
            status=TaskStatus.RUNNING,
        )
        session.add_all([orphan_task, fresh_task, internal_task])
        await session.flush()
        old_step = TaskStep(
            task_id=orphan_task.id,
            step_name="integration_dispatch:codex:n1",
            status="running",
            started_at=utc_now() - timedelta(minutes=30),
        )
        fresh_step = TaskStep(
            task_id=fresh_task.id,
            step_name="integration_dispatch:codex:n1",
            status="running",
            started_at=utc_now(),
        )
        internal_step = TaskStep(
            task_id=internal_task.id,
            step_name="llm_call",
            status="running",
            started_at=utc_now() - timedelta(minutes=30),
        )
        session.add_all([old_step, fresh_step, internal_step])
        await session.commit()
        orphan_id, fresh_id, internal_id = orphan_task.id, fresh_task.id, internal_task.id

        recovered = await recover_orphan_integration_steps(session, lease_minutes=10)
        assert recovered == 1

        orphan_after = await session.get(Task, orphan_id)
        fresh_after = await session.get(Task, fresh_id)
        internal_after = await session.get(Task, internal_id)
        assert orphan_after.status == TaskStatus.FAILED
        assert fresh_after.status == TaskStatus.RUNNING
        assert internal_after.status == TaskStatus.RUNNING

    await engine.dispose()
