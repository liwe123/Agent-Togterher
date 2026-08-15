import asyncio
from collections.abc import Iterator
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base
from app.db.session import get_db
from app.main import app


@pytest.fixture
def rbac_client(tmp_path) -> Iterator[TestClient]:
    database_path = tmp_path / "rbac-test.db"
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


def test_rbac_and_multitenant_flow(rbac_client: TestClient) -> None:
    # 1. 注册首个用户（自动成为 Owner）
    res_u1 = rbac_client.post(
        "/api/v1/auth/register",
        json={"email": "owner@example.com", "password": "Password123!", "display_name": "Alice Owner"},
    )
    assert res_u1.status_code == 200
    u1_token = res_u1.json()["data"]["access_token"]
    u1_id = res_u1.json()["data"]["user"]["id"]

    # 2. 查询我的工作区列表
    my_ws_res = rbac_client.get(
        "/api/v1/workspaces/my",
        headers={"Authorization": f"Bearer {u1_token}"},
    )
    assert my_ws_res.status_code == 200
    my_workspaces = my_ws_res.json()["data"]
    assert len(my_workspaces) >= 1
    ws_id = my_workspaces[0]["id"]
    assert my_workspaces[0]["role"] == "owner"

    # 3. 创建新工作区
    create_ws_res = rbac_client.post(
        "/api/v1/workspaces",
        json={"name": "Alice Team", "description": "Alice's dedicated team space"},
        headers={"Authorization": f"Bearer {u1_token}"},
    )
    assert create_ws_res.status_code == 200
    team_ws_id = create_ws_res.json()["data"]["id"]
    assert create_ws_res.json()["data"]["role"] == "owner"

    # 4. 生成邀请码（邀请 member）
    invite_res = rbac_client.post(
        f"/api/v1/workspaces/{team_ws_id}/members/invite",
        json={"role": "member"},
        headers={"Authorization": f"Bearer {u1_token}"},
    )
    assert invite_res.status_code == 200
    invite_code = invite_res.json()["data"]["invite_code"]

    # 5. 注册第二个用户 Bob
    res_u2 = rbac_client.post(
        "/api/v1/auth/register",
        json={"email": "bob@example.com", "password": "Password123!", "display_name": "Bob Member"},
    )
    assert res_u2.status_code == 200
    u2_token = res_u2.json()["data"]["access_token"]
    u2_id = res_u2.json()["data"]["user"]["id"]

    # 6. Bob 使用邀请码加入 Alice Team
    join_res = rbac_client.post(
        "/api/v1/workspaces/join",
        json={"invite_code": invite_code},
        headers={"Authorization": f"Bearer {u2_token}"},
    )
    assert join_res.status_code == 200
    assert join_res.json()["data"]["id"] == team_ws_id
    assert join_res.json()["data"]["role"] == "member"

    # 7. Alice 查看成员列表
    members_res = rbac_client.get(
        f"/api/v1/workspaces/{team_ws_id}/members",
        headers={"Authorization": f"Bearer {u1_token}"},
    )
    assert members_res.status_code == 200
    members = members_res.json()["data"]
    assert len(members) == 2
    emails = {m["email"] for m in members}
    assert "owner@example.com" in emails
    assert "bob@example.com" in emails

    # 8. 越权测试：作为 member 的 Bob 试图生成邀请码应被拒绝 (403)
    bob_invite_res = rbac_client.post(
        f"/api/v1/workspaces/{team_ws_id}/members/invite",
        json={"role": "admin"},
        headers={"Authorization": f"Bearer {u2_token}"},
    )
    assert bob_invite_res.status_code == 403

    # 9. Alice 将 Bob 提升为 admin
    promote_res = rbac_client.put(
        f"/api/v1/workspaces/{team_ws_id}/members/{u2_id}/role",
        json={"role": "admin"},
        headers={"Authorization": f"Bearer {u1_token}"},
    )
    assert promote_res.status_code == 200

    # 10. Bob 现在是 admin，生成邀请码应成功
    bob_admin_invite = rbac_client.post(
        f"/api/v1/workspaces/{team_ws_id}/members/invite",
        json={"role": "viewer"},
        headers={"Authorization": f"Bearer {u2_token}"},
    )
    assert bob_admin_invite.status_code == 200

    # 11. Alice 移除 Bob
    remove_res = rbac_client.delete(
        f"/api/v1/workspaces/{team_ws_id}/members/{u2_id}",
        headers={"Authorization": f"Bearer {u1_token}"},
    )
    assert remove_res.status_code == 200

    # 12. 确认 Bob 已不在该工作区
    members_after = rbac_client.get(
        f"/api/v1/workspaces/{team_ws_id}/members",
        headers={"Authorization": f"Bearer {u1_token}"},
    ).json()["data"]
    assert len(members_after) == 1
