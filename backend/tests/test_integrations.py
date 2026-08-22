from __future__ import annotations

from collections.abc import Iterator
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base
from app.db.session import get_db
from app.main import app
from app.services.bridge import BridgeResult
from app.services.integration_service import dispatch_task_to_node


@pytest.fixture
def integration_client(tmp_path) -> Iterator[TestClient]:
    database_path = tmp_path / "integrations-test.db"
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
        with TestClient(app) as client:
            yield client
    finally:
        app.dependency_overrides.clear()
        asyncio.run(engine.dispose())


def assert_success(response, status_code: int = 200):
    assert response.status_code == status_code, response.text
    body = response.json()
    assert body["success"] is True
    return body["data"]


def create_workspace(client: TestClient, name: str = "Integration workspace") -> dict:
    return assert_success(
        client.post(
            "/api/workspaces",
            json={"name": name, "description": "integration test workspace"},
        ),
        201,
    )


def create_task(client: TestClient, workspace_id: int) -> dict:
    return assert_success(
        client.post(
            "/api/tasks",
            json={
                "workspace_id": workspace_id,
                "title": "Dispatch task",
                "description": "Run through integration bridge",
            },
        ),
        201,
    )


def create_node(client: TestClient, workspace_id: int, provider: str = "codex") -> dict:
    return assert_success(
        client.post(
            "/api/v1/integrations/nodes",
            json={
                "workspace_id": workspace_id,
                "name": f"{provider}-node",
                "provider": provider,
                "mode": "cli" if provider == "codex" else "bridge",
                "status": "online",
                "capabilities": ["code_edit", "doc_write"],
                "max_concurrency": 2,
            },
        ),
        201,
    )


def test_register_heartbeat_and_list_nodes(integration_client: TestClient) -> None:
    workspace = create_workspace(integration_client)
    node = create_node(integration_client, workspace["id"])

    listed = assert_success(
        integration_client.get(
            "/api/v1/integrations/nodes", params={"workspace_id": workspace["id"]}
        )
    )
    assert listed[0]["id"] == node["id"]
    assert listed[0]["capabilities"] == ["code_edit", "doc_write"]

    heartbeat = assert_success(
        integration_client.post(
            f"/api/v1/integrations/nodes/{node['id']}/heartbeat",
            json={
                "node_id": node["id"],
                "status": "busy",
                "version": "1.0.0",
                "capabilities": ["code_edit"],
                "current_task_count": 1,
            },
        )
    )
    assert heartbeat["status"] == "busy"
    assert heartbeat["version"] == "1.0.0"
    assert heartbeat["current_task_count"] == 1


def test_dispatch_to_node_accepts_and_schedules_background(
    integration_client: TestClient,
    tmp_path,
) -> None:
    workspace = create_workspace(integration_client)
    node = create_node(integration_client, workspace["id"])
    task = create_task(integration_client, workspace["id"])

    scheduled: list[tuple] = []

    def fake_schedule(task_id: int, node_id: int, package=None) -> None:
        scheduled.append((task_id, node_id, package))

    with patch(
        "app.api.v1.endpoints.integrations.schedule_node_dispatch",
        side_effect=fake_schedule,
    ):
        result = assert_success(
            integration_client.post(
                "/api/v1/integrations/dispatch",
                json={
                    "task_id": task["id"],
                    "node_id": node["id"],
                    "acceptance_criteria": ["构建通过"],
                    "test_command": "npm run build",
                    "budget_seconds": 120,
                },
            )
        )

    assert result["success"] is True
    assert result["status"] == "accepted"
    assert result["node_id"] == node["id"]
    assert result["task_id"] == task["id"]
    assert len(scheduled) == 1
    scheduled_task_id, scheduled_node_id, package = scheduled[0]
    assert scheduled_task_id == task["id"]
    assert scheduled_node_id == node["id"]
    assert package.acceptance_criteria == ["构建通过"]
    assert package.test_command == "npm run build"
    assert package.budget_seconds == 120

    refreshed_task = assert_success(integration_client.get(f"/api/tasks/{task['id']}"))
    assert refreshed_task["status"] == "pending"


def test_dispatch_rejects_unsupported_provider(integration_client: TestClient) -> None:
    workspace = create_workspace(integration_client)
    node = create_node(integration_client, workspace["id"], provider="trae")
    task = create_task(integration_client, workspace["id"])

    response = integration_client.post(
        "/api/v1/integrations/dispatch",
        json={"task_id": task["id"], "node_id": node["id"]},
    )
    assert response.status_code == 422
    assert "trae" in response.text


@pytest.mark.asyncio
async def test_dispatch_service_supports_result_writes(tmp_path) -> None:
    engine = create_async_engine(f"sqlite+aiosqlite:///{(tmp_path / 'svc.db').as_posix()}")
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    from app.models import IntegrationNode, Task, Workspace
    from app.services.integration_service import dispatch_task_to_node

    async with factory() as session:
        workspace = Workspace(name="svc", description="svc")
        session.add(workspace)
        await session.flush()
        task = Task(workspace_id=workspace.id, title="svc task", description="dispatch me")
        session.add(task)
        node = IntegrationNode(
            workspace_id=workspace.id,
            name="codex-node",
            provider="codex",
            mode="cli",
            status="online",
            current_task_count=0,
            max_concurrency=2,
        )
        session.add(node)
        await session.commit()
        await session.refresh(task)
        await session.refresh(node)

        bridge = AsyncMock()
        bridge.execute.return_value = BridgeResult(
            success=True,
            message="ok",
            artifacts=[],
            metadata={},
        )
        bridge.prepare_task.return_value = type(
            "PreparedTask",
            (),
            {
                "task_id": task.id,
                "task_title": task.title,
                "task_description": task.description,
                "workspace_id": workspace.id,
                "task_workdir": tmp_path,
                "prompt_path": tmp_path / "PROMPT.md",
                "task_json_path": tmp_path / "task.json",
                "output_path": tmp_path / "output.md",
                "events_path": tmp_path / "events.jsonl",
            },
        )

        with patch("app.services.integration_service.build_bridge", return_value=bridge):
            result = await dispatch_task_to_node(session, task, node)

        assert result.success is True
        assert task.result == "ok"
        assert task.status.value == "completed"

    await engine.dispose()
