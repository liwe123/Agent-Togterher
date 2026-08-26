"""Tests for WebSocket handshake authentication and Origin checks (C-158, C-157a)."""

import time
from collections.abc import Iterator
from unittest.mock import patch

import jwt as pyjwt
import pytest
from fastapi import WebSocketDisconnect
from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.auth import _get_secret_key, create_access_token
from app.core.config import get_settings
from app.db.base import Base
from app.db.session import get_db
from app.main import app

WORKSPACE_NOT_FOUND = {
    "type": "error",
    "payload": {"message": "Workspace not found"},
}


@pytest.fixture
def ws_client(tmp_path) -> Iterator[TestClient]:
    database_path = tmp_path / "ws-auth-test.db"
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
        with patch("app.core.message_hub.dispatch_background_task"):
            with TestClient(app) as client:
                yield client
    finally:
        app.dependency_overrides.clear()
        asyncio.run(engine.dispose())


@pytest.fixture
def settings():
    current = get_settings()
    saved_token = current.app_api_token
    saved_origins = list(current.ws_allowed_origins)
    try:
        yield current
    finally:
        current.app_api_token = saved_token
        current.ws_allowed_origins = saved_origins


def expect_policy_violation(client: TestClient, url: str, **kwargs) -> None:
    with pytest.raises(WebSocketDisconnect) as excinfo:
        with client.websocket_connect(url, **kwargs) as websocket:
            websocket.receive_json()
    assert excinfo.value.code == 1008


def connect_expect_error_event(client: TestClient, url: str, **kwargs) -> None:
    with client.websocket_connect(url, **kwargs) as websocket:
        assert websocket.receive_json() == WORKSPACE_NOT_FOUND


def expired_access_token() -> str:
    now = time.time()
    return pyjwt.encode(
        {
            "sub": "1",
            "type": "access",
            "iat": int(now - 7200),
            "exp": int(now - 3600),
        },
        _get_secret_key(),
        algorithm="HS256",
    )


def test_static_token_still_accepted(ws_client: TestClient, settings) -> None:
    settings.app_api_token = SecretStr("ws-static-token")
    connect_expect_error_event(
        ws_client,
        "/ws/workspaces/99999",
        headers={"x-api-key": "ws-static-token"},
    )
    connect_expect_error_event(
        ws_client,
        "/ws/workspaces/99999",
        headers={"Authorization": "Bearer ws-static-token"},
    )


def test_missing_token_rejected_when_static_configured(
    ws_client: TestClient, settings
) -> None:
    settings.app_api_token = SecretStr("ws-static-token")
    expect_policy_violation(ws_client, "/ws/workspaces/99999")


def test_wrong_static_token_rejected(ws_client: TestClient, settings) -> None:
    settings.app_api_token = SecretStr("ws-static-token")
    expect_policy_violation(
        ws_client,
        "/ws/workspaces/99999",
        headers={"x-api-key": "wrong-token"},
    )


def test_valid_jwt_accepted_alongside_static_token(
    ws_client: TestClient, settings
) -> None:
    settings.app_api_token = SecretStr("ws-static-token")
    token = create_access_token(42)
    connect_expect_error_event(
        ws_client,
        f"/ws/workspaces/99999?token={token}",
    )
    connect_expect_error_event(
        ws_client,
        "/ws/workspaces/99999",
        headers={"Authorization": f"Bearer {token}"},
    )


def test_valid_jwt_accepted_without_static_token(
    ws_client: TestClient, settings
) -> None:
    settings.app_api_token = None
    token = create_access_token(42)
    connect_expect_error_event(
        ws_client,
        f"/ws/workspaces/99999?token={token}",
    )


def test_expired_jwt_rejected(ws_client: TestClient, settings) -> None:
    settings.app_api_token = SecretStr("ws-static-token")
    expect_policy_violation(
        ws_client,
        f"/ws/workspaces/99999?token={expired_access_token()}",
    )


def test_garbage_jwt_rejected_when_static_configured(
    ws_client: TestClient, settings
) -> None:
    settings.app_api_token = SecretStr("ws-static-token")
    expect_policy_violation(
        ws_client,
        "/ws/workspaces/99999",
        headers={"Authorization": "Bearer not-a-jwt"},
    )


def test_open_mode_without_credentials_still_connects(
    ws_client: TestClient, settings
) -> None:
    settings.app_api_token = None
    connect_expect_error_event(ws_client, "/ws/workspaces/99999")


def test_origin_whitelist_empty_allows_any_origin(
    ws_client: TestClient, settings
) -> None:
    settings.ws_allowed_origins = []
    connect_expect_error_event(
        ws_client,
        "/ws/workspaces/99999",
        headers={"origin": "http://evil.example"},
    )
    connect_expect_error_event(ws_client, "/ws/workspaces/99999")


def test_origin_whitelist_enforced_when_configured(
    ws_client: TestClient, settings
) -> None:
    settings.ws_allowed_origins = ["http://localhost:3000"]
    connect_expect_error_event(
        ws_client,
        "/ws/workspaces/99999",
        headers={"origin": "http://localhost:3000"},
    )
    connect_expect_error_event(
        ws_client,
        "/ws/workspaces/99999",
        headers={"origin": "http://localhost:3000/"},
    )
    connect_expect_error_event(ws_client, "/ws/workspaces/99999")
    expect_policy_violation(
        ws_client,
        "/ws/workspaces/99999",
        headers={"origin": "http://evil.example"},
    )
