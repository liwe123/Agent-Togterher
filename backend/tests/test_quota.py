import asyncio
from collections.abc import Iterator
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base
from app.db.session import get_db
from app.main import app


@pytest.fixture
def quota_client(tmp_path) -> Iterator[TestClient]:
    database_path = tmp_path / "quota-test.db"
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


def test_quota_management_flow(quota_client: TestClient) -> None:
    # 1. 注册获取 Owner token
    res = quota_client.post(
        "/api/v1/auth/register",
        json={"email": "quotaowner@example.com", "password": "Password123!", "display_name": "Quota Owner"},
    )
    assert res.status_code == 200
    token = res.json()["data"]["access_token"]

    my_ws_res = quota_client.get(
        "/api/v1/workspaces/my",
        headers={"Authorization": f"Bearer {token}"},
    )
    ws_id = my_ws_res.json()["data"][0]["id"]

    # 2. 查询默认配额
    get_res = quota_client.get(
        f"/api/v1/workspaces/{ws_id}/quota",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert get_res.status_code == 200
    data = get_res.json()["data"]
    assert data["budget_usd"] == 100.0
    assert data["is_hard_limit"] is False
    assert data["percent_spent"] == 0.0

    # 3. 更新配额设置
    put_res = quota_client.put(
        f"/api/v1/workspaces/{ws_id}/quota",
        json={"monthly_budget_usd": 500.0, "is_hard_limit": True, "max_concurrent_tasks": 10},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert put_res.status_code == 200
    updated = put_res.json()["data"]
    assert updated["monthly_budget_usd"] == 500.0
    assert updated["is_hard_limit"] is True
    assert updated["max_concurrent_tasks"] == 10
