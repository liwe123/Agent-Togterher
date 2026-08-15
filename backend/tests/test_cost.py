import asyncio
from collections.abc import Iterator
from datetime import datetime, timezone
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base
from app.db.session import get_db
from app.main import app
from app.models.model_call import ModelCall
from app.models.task import Task


@pytest.fixture
def cost_client(tmp_path) -> Iterator[TestClient]:
    database_path = tmp_path / "cost-test.db"
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
        with TestClient(app) as client:
            yield client
    finally:
        app.dependency_overrides.clear()
        asyncio.run(engine.dispose())


def test_cost_statistics_flow(cost_client: TestClient, tmp_path) -> None:
    # 1. 注册并获取工作区
    res = cost_client.post(
        "/api/v1/auth/register",
        json={"email": "costadmin@example.com", "password": "Password123!", "display_name": "Cost Admin"},
    )
    assert res.status_code == 200
    token = res.json()["data"]["access_token"]

    my_ws_res = cost_client.get(
        "/api/v1/workspaces/my",
        headers={"Authorization": f"Bearer {token}"},
    )
    ws_id = my_ws_res.json()["data"][0]["id"]

    # 2. 获取空状态下的成本 summary
    summary_res = cost_client.get(
        f"/api/v1/workspaces/{ws_id}/cost/summary",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert summary_res.status_code == 200
    summary_data = summary_res.json()["data"]
    assert summary_data["total_cost_usd"] == 0.0
    assert summary_data["total_tokens"] == 0

    # 3. 获取每日趋势
    trend_res = cost_client.get(
        f"/api/v1/workspaces/{ws_id}/cost/daily-trend",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert trend_res.status_code == 200
    assert isinstance(trend_res.json()["data"], list)

    # 4. 获取模型分布
    model_res = cost_client.get(
        f"/api/v1/workspaces/{ws_id}/cost/by-model",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert model_res.status_code == 200
    assert isinstance(model_res.json()["data"], list)

    # 5. 获取 Top 任务
    top_res = cost_client.get(
        f"/api/v1/workspaces/{ws_id}/cost/top-tasks",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert top_res.status_code == 200
    assert isinstance(top_res.json()["data"], list)
