import asyncio
from collections.abc import Iterator
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
    # 原为 task_id = run_data["task_id"] 的隐式键存在性检查（F841 清理时被一并
    # 移除），此处补回为显式断言（独立验收 2026-10-09 提示 2）。
    assert "task_id" in run_data

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


def test_workflow_run_history_and_isolation(workflow_client: TestClient) -> None:
    """运行记录读 API（PRD-工作流运行记录与画布可视化 FR1/FR2 + AC1~AC4）。"""

    def register(email: str, name: str) -> tuple[str, int]:
        res = workflow_client.post(
            "/api/v1/auth/register",
            json={"email": email, "password": "Password123!", "display_name": name},
        )
        assert res.status_code == 200
        token = res.json()["data"]["access_token"]
        headers = {"Authorization": f"Bearer {token}"}
        ws = workflow_client.get("/api/v1/workspaces/my", headers=headers).json()["data"][0]["id"]
        return token, ws

    token_a, ws_a = register("wf_runs_a@example.com", "Runs A")
    headers_a = {"Authorization": f"Bearer {token_a}"}

    nodes = [
        {
            "id": "n1",
            "name": "取数",
            "agent_role": "coder",
            "prompt_template": "查询 {{table}} 的近 7 日数据。",
            "dependencies": [],
        },
        {
            "id": "n2",
            "name": "复核",
            "agent_role": "reviewer",
            "prompt_template": "复核 n1 的结果。",
            "dependencies": ["n1"],
        },
    ]
    create_res = workflow_client.post(
        f"/api/v1/workspaces/{ws_a}/workflows",
        headers=headers_a,
        json={
            "name": "runs-api-pipeline",
            "display_name": "运行记录读 API 流水线",
            "description": "用于验收运行历史读接口",
            "nodes": nodes,
            "variables": [{"key": "table", "label": "表名", "default": "orders"}],
        },
    )
    assert create_res.status_code == 200
    tpl_id = create_res.json()["data"]["id"]

    run_res = workflow_client.post(
        f"/api/v1/workspaces/{ws_a}/workflows/{tpl_id}/run",
        headers=headers_a,
        json={"variables": {"table": "orders"}},
    )
    assert run_res.status_code == 200
    task_id = run_res.json()["data"]["task_id"]

    # AC1：列表按倒序返回，字段完整
    list_res = workflow_client.get(
        f"/api/v1/workspaces/{ws_a}/workflows/{tpl_id}/runs", headers=headers_a
    )
    assert list_res.status_code == 200, list_res.text
    runs = list_res.json()["data"]
    assert len(runs) >= 1
    latest = runs[0]
    assert latest["task_id"] == task_id
    assert latest["template_id"] == tpl_id
    assert latest["status"] in {"running", "completed", "failed"}
    assert latest["created_at"]
    # FR3 要求列表展示节点数：该次运行的两节点模板快照应解析出 2
    assert latest["nodes_count"] == 2

    # AC4：详情返回解析后的节点快照（快照为运行时渲染后的节点数组）
    detail_res = workflow_client.get(
        f"/api/v1/workspaces/{ws_a}/workflows/{tpl_id}/runs/{latest['id']}",
        headers=headers_a,
    )
    assert detail_res.status_code == 200, detail_res.text
    detail = detail_res.json()["data"]
    assert detail["id"] == latest["id"]
    assert detail["task_id"] == task_id
    assert isinstance(detail["nodes"], list)

    # AC2：limit 上限 50
    over = workflow_client.get(
        f"/api/v1/workspaces/{ws_a}/workflows/{tpl_id}/runs?limit=51", headers=headers_a
    )
    assert over.status_code == 422

    # AC3：不存在的 run / 模板
    missing_run = workflow_client.get(
        f"/api/v1/workspaces/{ws_a}/workflows/{tpl_id}/runs/999999", headers=headers_a
    )
    assert missing_run.status_code == 404
    missing_tpl = workflow_client.get(
        f"/api/v1/workspaces/{ws_a}/workflows/999999/runs", headers=headers_a
    )
    assert missing_tpl.status_code == 404

    # AC3：非成员访问 → 403（workflow_runs 无 workspace_id，隔离经 tasks 反查）。
    # 注意：按当前注册语义，新用户会自动加入「第一个」工作区，因此不能拿 B 访问
    # ws_a 来验证 403；这里由 A 另建一个工作区，B 不是其成员。
    token_b, _ws_b = register("wf_runs_b@example.com", "Runs B")
    ws2_res = workflow_client.post(
        "/api/v1/workspaces",
        headers=headers_a,
        json={"name": "Runs 隔离工作区", "description": "验证非成员 403"},
    )
    assert ws2_res.status_code == 200
    ws2 = ws2_res.json()["data"]["id"]
    assert ws2 != ws_a

    foreign = workflow_client.get(
        f"/api/v1/workspaces/{ws2}/workflows/{tpl_id}/runs",
        headers={"Authorization": f"Bearer {token_b}"},
    )
    assert foreign.status_code == 403
