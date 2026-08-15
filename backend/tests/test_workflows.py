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
def workflow_client(tmp_path) -> Iterator[TestClient]:
    database_path = tmp_path / "workflows-test.db"
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


def test_workflow_lifecycle(workflow_client: TestClient) -> None:
    # 1. 注册工作区 Owner 用户
    reg_res = workflow_client.post(
        "/api/v1/auth/register",
        json={"email": "wf_admin@example.com", "password": "Password123!", "display_name": "WF Admin"},
    )
    assert reg_res.status_code == 200
    token = reg_res.json()["data"]["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # 获取自动分配的工作区
    my_ws_res = workflow_client.get("/api/v1/workspaces/my", headers=headers)
    assert my_ws_res.status_code == 200
    ws_id = my_ws_res.json()["data"][0]["id"]

    # 2. 查询工作流模板列表（自动生成系统预设）
    list_res = workflow_client.get(f"/api/v1/workspaces/{ws_id}/workflows", headers=headers)
    assert list_res.status_code == 200
    templates = list_res.json()["data"]
    assert len(templates) >= 2
    system_tpl = next(t for t in templates if t["is_system"])
    assert system_tpl["name"] == "fullstack-feature-dev"

    # 3. 创建自定义工作流模板
    custom_nodes = [
        {
            "id": "step-1",
            "name": "SQL 查询编写",
            "agent_role": "coder",
            "prompt_template": "编写针对 {{table_name}} 表的统计 SQL 查询，条件是 {{condition}}。",
            "dependencies": [],
        },
        {
            "id": "step-2",
            "name": "查询性能优化",
            "agent_role": "reviewer",
            "prompt_template": "评估前序针对 {{table_name}} 的 SQL 性能并给出索引建议。",
            "dependencies": ["step-1"],
        },
    ]
    custom_vars = [
        {
            "key": "table_name",
            "label": "目标数据表",
            "default": "users",
            "required": True,
        },
        {
            "key": "condition",
            "label": "过滤条件",
            "default": "created_at >= '2026-01-01'",
            "required": True,
        },
    ]

    create_res = workflow_client.post(
        f"/api/v1/workspaces/{ws_id}/workflows",
        headers=headers,
        json={
            "name": "sql-optimizer-pipeline",
            "display_name": "SQL 编写与性能优化流水线",
            "description": "自动编写 SQL 并由专家审查索引与执行计划",
            "icon": "database",
            "nodes": custom_nodes,
            "variables": custom_vars,
        },
    )
    assert create_res.status_code == 200
    custom_tpl = create_res.json()["data"]
    assert custom_tpl["name"] == "sql-optimizer-pipeline"
    assert custom_tpl["is_system"] is False
    custom_id = custom_tpl["id"]

    # 4. 一键运行自定义模板（变量替换并实例化任务）
    run_res = workflow_client.post(
        f"/api/v1/workspaces/{ws_id}/workflows/{custom_id}/run",
        headers=headers,
        json={
            "variables": {
                "table_name": "orders",
                "condition": "status = 'paid' AND amount > 1000",
            },
        },
    )
    assert run_res.status_code == 200
    run_data = run_res.json()["data"]
    assert run_data["status"] == "pending"
    assert run_data["workflow_id"] == custom_id
    assert "orders" in run_data["title"]
    task_id = run_data["task_id"]

    # 5. 验证系统预设模板不可删除
    del_sys_res = workflow_client.delete(
        f"/api/v1/workspaces/{ws_id}/workflows/{system_tpl['id']}",
        headers=headers,
    )
    assert del_sys_res.status_code == 403

    # 6. 删除自定义模板
    del_res = workflow_client.delete(
        f"/api/v1/workspaces/{ws_id}/workflows/{custom_id}",
        headers=headers,
    )
    assert del_res.status_code == 200
    assert del_res.json()["data"]["deleted_id"] == custom_id
