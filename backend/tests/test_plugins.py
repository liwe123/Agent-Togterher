import asyncio
from collections.abc import Iterator
import json
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base
from app.db.session import get_db
from app.main import app


@pytest.fixture
def plugin_client(tmp_path) -> Iterator[TestClient]:
    database_path = tmp_path / "plugins-test.db"
    engine = create_async_engine(f"sqlite+aiosqlite:///{database_path.as_posix()}")
    session_factory = async_sessionmaker(engine, expire_on_commit=False)

    async def create_schema() -> None:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)

    asyncio.run(create_schema())

    async def override_get_db():
        async with session_factory() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    try:
        with TestClient(app) as client:
            yield client
    finally:
        app.dependency_overrides.clear()
        asyncio.run(engine.dispose())


def test_plugin_lifecycle(plugin_client: TestClient) -> None:
    # 1. 注册工作区所有者用户
    reg_res = plugin_client.post(
        "/api/v1/auth/register",
        json={"email": "plugin_admin@example.com", "password": "Password123!", "display_name": "Plugin Admin"},
    )
    assert reg_res.status_code == 200
    token = reg_res.json()["data"]["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # 获取自动分配的工作区
    my_ws_res = plugin_client.get("/api/v1/workspaces/my", headers=headers)
    assert my_ws_res.status_code == 200
    ws_id = my_ws_res.json()["data"][0]["id"]

    # 2. 注册新插件
    manifest = {
        "name": "github-actions",
        "display_name": "GitHub Actions CI",
        "version": "1.0.0",
        "tools": [
            {
                "name": "trigger_workflow",
                "description": "Trigger a GitHub Actions workflow run",
                "parameters": {"repo": "string", "workflow_id": "string"},
            },
            {
                "name": "get_workflow_status",
                "description": "Get status of a workflow run",
                "parameters": {"run_id": "integer"},
            },
        ],
    }

    create_res = plugin_client.post(
        "/api/v1/plugins",
        headers=headers,
        json={
            "name": "github-actions",
            "display_name": "GitHub Actions CI",
            "description": "CI/CD automation plugin",
            "version": "1.0.0",
            "icon": "github",
            "manifest_json": json.dumps(manifest),
            "is_public": True,
        },
    )
    assert create_res.status_code == 200
    plugin_data = create_res.json()["data"]
    assert plugin_data["name"] == "github-actions"
    assert plugin_data["tools_count"] == 2
    plugin_id = plugin_data["id"]

    # 3. 重复注册抛出 409
    dup_res = plugin_client.post(
        "/api/v1/plugins",
        headers=headers,
        json={
            "name": "github-actions",
            "display_name": "Duplicate",
            "manifest_json": "{}",
        },
    )
    assert dup_res.status_code == 409

    # 4. 检索插件列表（未挂载）
    list_res = plugin_client.get(f"/api/v1/plugins?workspace_id={ws_id}", headers=headers)
    assert list_res.status_code == 200
    plugins = list_res.json()["data"]
    assert len(plugins) >= 1
    assert plugins[0]["is_installed"] is False

    # 5. 在工作区启用插件
    toggle_res = plugin_client.post(
        f"/api/v1/workspaces/{ws_id}/plugins/{plugin_id}/toggle",
        headers=headers,
        json={"is_enabled": True, "config": {"api_token": "ghp_mock_123"}},
    )
    assert toggle_res.status_code == 200
    wp_data = toggle_res.json()["data"]
    assert wp_data["is_enabled"] is True

    # 6. 再次查询插件列表（已挂载且已启用）
    list_res2 = plugin_client.get(f"/api/v1/plugins?workspace_id={ws_id}", headers=headers)
    assert list_res2.status_code == 200
    plugins2 = list_res2.json()["data"]
    assert plugins2[0]["is_installed"] is True
    assert plugins2[0]["is_enabled"] is True

    # 7. 获取工作区可用插件工具列表
    tools_res = plugin_client.get(f"/api/v1/workspaces/{ws_id}/plugins/active-tools", headers=headers)
    assert tools_res.status_code == 200
    active_tools = tools_res.json()["data"]
    assert len(active_tools) == 2
    assert active_tools[0]["name"] == "trigger_workflow"
    assert active_tools[0]["plugin_name"] == "github-actions"
