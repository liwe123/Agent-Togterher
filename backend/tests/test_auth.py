import asyncio
from collections.abc import Iterator
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.config import get_settings
from app.db.base import Base
from app.db.session import get_db
from app.main import app


@pytest.fixture
def auth_client(tmp_path) -> Iterator[TestClient]:
    database_path = tmp_path / "auth-test.db"
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


def test_register_and_login_flow(auth_client: TestClient) -> None:
    # 1. 注册新用户
    reg_res = auth_client.post(
        "/api/v1/auth/register",
        json={
            "email": "test@example.com",
            "password": "Password123!",
            "display_name": "Test User",
        },
    )
    assert reg_res.status_code == 200
    reg_data = reg_res.json()
    assert reg_data["success"] is True
    assert reg_data["data"]["user"]["email"] == "test@example.com"
    assert reg_data["data"]["user"]["display_name"] == "Test User"
    assert "access_token" in reg_data["data"]
    assert "refresh_token" in reg_data["data"]

    # 2. 重复注册应返回 409
    dup_res = auth_client.post(
        "/api/v1/auth/register",
        json={
            "email": "test@example.com",
            "password": "OtherPassword",
            "display_name": "Duplicate User",
        },
    )
    assert dup_res.status_code == 409
    assert dup_res.json()["success"] is False

    # 3. 登录成功
    login_res = auth_client.post(
        "/api/v1/auth/login",
        json={
            "email": "test@example.com",
            "password": "Password123!",
        },
    )
    assert login_res.status_code == 200
    login_data = login_res.json()
    assert login_data["success"] is True
    access_token = login_data["data"]["access_token"]
    refresh_token = login_data["data"]["refresh_token"]

    # 4. 登录失败：密码错误
    wrong_pwd_res = auth_client.post(
        "/api/v1/auth/login",
        json={
            "email": "test@example.com",
            "password": "WrongPassword",
        },
    )
    assert wrong_pwd_res.status_code == 401

    # 5. 登录失败：邮箱不存在
    no_user_res = auth_client.post(
        "/api/v1/auth/login",
        json={
            "email": "nobody@example.com",
            "password": "Password123!",
        },
    )
    assert no_user_res.status_code == 401

    # 6. 获取当前用户信息 /me
    me_res = auth_client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {access_token}"},
    )
    assert me_res.status_code == 200
    me_data = me_res.json()
    assert me_data["success"] is True
    assert me_data["data"]["email"] == "test@example.com"
    assert me_data["data"]["display_name"] == "Test User"

    # 7. 刷新 token
    refresh_res = auth_client.post(
        "/api/v1/auth/refresh",
        json={"refresh_token": refresh_token},
    )
    assert refresh_res.status_code == 200
    new_access_token = refresh_res.json()["data"]["access_token"]
    assert new_access_token is not None

    # 8. 使用新的 access_token 请求 /me
    me_new_res = auth_client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {new_access_token}"},
    )
    assert me_new_res.status_code == 200

    # 9. 使用无效的 refresh_token 应返回 401
    bad_refresh = auth_client.post(
        "/api/v1/auth/refresh",
        json={"refresh_token": "invalid.jwt.token"},
    )
    assert bad_refresh.status_code == 401

    # 10. 登出
    logout_res = auth_client.post("/api/v1/auth/logout")
    assert logout_res.status_code == 200
