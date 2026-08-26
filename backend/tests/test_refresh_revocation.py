"""refresh token 吊销与 logout 相关测试。"""

import asyncio
import time
from collections.abc import Iterator

import jwt as pyjwt
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.auth import REFRESH_TOKEN_EXPIRE_DAYS, _get_secret_key, get_jti_from_token
from app.db.base import Base
from app.db.session import get_db
from app.main import app
from app.models.refresh_token import RefreshToken


@pytest.fixture
def auth_client(tmp_path) -> Iterator[TestClient]:
    database_path = tmp_path / "refresh-test.db"
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


def register_user(client: TestClient, email: str, password: str = "secret123"):
    response = client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": password, "display_name": email.split("@")[0]},
    )
    assert response.status_code == 200, response.text
    return response.json()["data"]


def test_logout_revokes_refresh_token(auth_client: TestClient) -> None:
    data = register_user(auth_client, "revoke@example.com")
    refresh_token = data["refresh_token"]

    logout_response = auth_client.post(
        "/api/v1/auth/logout", json={"refresh_token": refresh_token}
    )
    assert logout_response.status_code == 200

    refresh_response = auth_client.post(
        "/api/v1/auth/refresh", json={"refresh_token": refresh_token}
    )
    assert refresh_response.status_code == 401


def test_logout_is_idempotent(auth_client: TestClient) -> None:
    data = register_user(auth_client, "idempotent@example.com")
    refresh_token = data["refresh_token"]

    first = auth_client.post(
        "/api/v1/auth/logout", json={"refresh_token": refresh_token}
    )
    second = auth_client.post(
        "/api/v1/auth/logout", json={"refresh_token": refresh_token}
    )
    assert first.status_code == 200
    assert second.status_code == 200


def test_logout_without_body_still_works(auth_client: TestClient) -> None:
    response = auth_client.post("/api/v1/auth/logout")
    assert response.status_code == 200


def test_logout_with_invalid_token_is_noop(auth_client: TestClient) -> None:
    response = auth_client.post(
        "/api/v1/auth/logout", json={"refresh_token": "not-a-real-token"}
    )
    assert response.status_code == 200


def test_refresh_works_before_logout(auth_client: TestClient) -> None:
    data = register_user(auth_client, "fresh@example.com")
    refresh_response = auth_client.post(
        "/api/v1/auth/refresh", json={"refresh_token": data["refresh_token"]}
    )
    assert refresh_response.status_code == 200
    assert "access_token" in refresh_response.json()["data"]


def test_revoking_one_token_does_not_affect_another(
    auth_client: TestClient,
) -> None:
    data = register_user(auth_client, "multi@example.com")
    first_token = data["refresh_token"]

    login_response = auth_client.post(
        "/api/v1/auth/login",
        json={"email": "multi@example.com", "password": "secret123"},
    )
    second_token = login_response.json()["data"]["refresh_token"]

    auth_client.post("/api/v1/auth/logout", json={"refresh_token": first_token})

    revoked = auth_client.post(
        "/api/v1/auth/refresh", json={"refresh_token": first_token}
    )
    assert revoked.status_code == 401

    active = auth_client.post(
        "/api/v1/auth/refresh", json={"refresh_token": second_token}
    )
    assert active.status_code == 200


def test_refresh_token_has_jti(auth_client: TestClient) -> None:
    data = register_user(auth_client, "jti@example.com")
    assert get_jti_from_token(data["refresh_token"]) is not None


def test_legacy_refresh_token_without_jti_still_accepted(
    auth_client: TestClient,
) -> None:
    """无 jti 的历史 token（本特性上线前签发）仍可用，直至过期。"""
    data = register_user(auth_client, "legacy@example.com")
    user_id = data["user"]["id"]

    now = time.time()
    legacy_payload = {
        "sub": str(user_id),
        "type": "refresh",
        "iat": now,
        "exp": now + REFRESH_TOKEN_EXPIRE_DAYS * 86400,
    }
    legacy_token = pyjwt.encode(
        legacy_payload, _get_secret_key(), algorithm="HS256"
    )

    response = auth_client.post(
        "/api/v1/auth/refresh", json={"refresh_token": legacy_token}
    )
    assert response.status_code == 200
