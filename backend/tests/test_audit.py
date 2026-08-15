import asyncio
from collections.abc import Iterator
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base
from app.db.session import get_db
from app.main import app


@pytest.fixture
def audit_client(tmp_path) -> Iterator[TestClient]:
    database_path = tmp_path / "audit-test.db"
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


def test_audit_logs_flow(audit_client: TestClient) -> None:
    # 1. 注册并登录（自动记录 user.register 和 user.login）
    res = audit_client.post(
        "/api/v1/auth/register",
        json={"email": "auditor@example.com", "password": "Password123!", "display_name": "Audit Admin"},
    )
    assert res.status_code == 200
    token = res.json()["data"]["access_token"]

    login_res = audit_client.post(
        "/api/v1/auth/login",
        json={"email": "auditor@example.com", "password": "Password123!"},
    )
    assert login_res.status_code == 200

    # 2. 查询我的工作区
    my_ws_res = audit_client.get(
        "/api/v1/workspaces/my",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert my_ws_res.status_code == 200
    ws_id = my_ws_res.json()["data"][0]["id"]

    # 3. 作为 Admin/Owner 查询审计日志
    logs_res = audit_client.get(
        f"/api/v1/workspaces/{ws_id}/audit-logs",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert logs_res.status_code == 200
    data = logs_res.json()["data"]
    assert data["total"] >= 2
    actions = [item["action"] for item in data["items"]]
    assert "user.register" in actions
    assert "user.login" in actions

    # 4. 按 action 过滤
    login_logs_res = audit_client.get(
        f"/api/v1/workspaces/{ws_id}/audit-logs?action=user.login",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert login_logs_res.status_code == 200
    login_items = login_logs_res.json()["data"]["items"]
    assert all(item["action"] == "user.login" for item in login_items)
