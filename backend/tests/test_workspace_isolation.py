"""Workspace isolation for the legacy ``/api`` surface (BUG-3 / D1).

JWT callers must always be scoped to a workspace they belong to: listing,
creating and reading conversations / messages / tasks / agents must never
leak across tenants when ``workspace_id`` is omitted or points at a foreign
workspace. Legacy static-token / open-mode passthrough is covered by
``test_rest_rbac.py``.
"""

from __future__ import annotations

import asyncio
from collections.abc import Iterator
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base
from app.db.session import get_db
from app.main import app


@pytest.fixture
def rest_client(tmp_path) -> Iterator[TestClient]:
    database_path = tmp_path / "workspace-isolation-test.db"
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
        with patch("app.core.message_hub.dispatch_background_task"):
            with TestClient(app) as client:
                yield client
    finally:
        app.dependency_overrides.clear()
        try:
            asyncio.run(engine.dispose())
        except OSError:
            pass


def register(client: TestClient, email: str, display_name: str) -> tuple[str, int]:
    response = client.post(
        "/api/v1/auth/register",
        json={
            "email": email,
            "password": "Password123!",
            "display_name": display_name,
        },
    )
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    return data["access_token"], data["user"]["id"]


def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def create_workspace(client: TestClient, token: str, name: str) -> int:
    response = client.post(
        "/api/v1/workspaces",
        json={"name": name, "description": "isolation fixture"},
        headers=auth(token),
    )
    assert response.status_code == 200, response.text
    return response.json()["data"]["id"]


def create_conversation(
    client: TestClient, token: str, workspace_id: int, title: str = "private chat"
) -> dict:
    response = client.post(
        "/api/conversations",
        json={"workspace_id": workspace_id, "title": title},
        headers=auth(token),
    )
    assert response.status_code == 201, response.text
    return response.json()["data"]


def test_jwt_list_conversations_without_workspace_id_returns_422(
    rest_client: TestClient,
) -> None:
    alice_token, _ = register(rest_client, "alice@example.com", "Alice")

    response = rest_client.get("/api/conversations", headers=auth(alice_token))

    assert response.status_code == 422
    assert response.json()["error"] == "workspace_id 为必填参数"


def test_jwt_foreign_workspace_conversations_are_rejected(
    rest_client: TestClient,
) -> None:
    alice_token, _ = register(rest_client, "alice@example.com", "Alice")
    bob_token, _ = register(rest_client, "bob@example.com", "Bob")
    bob_ws = create_workspace(rest_client, bob_token, "bob-team")

    # Alice is not a member of Bob's workspace -> list must be denied.
    response = rest_client.get(
        "/api/conversations",
        params={"workspace_id": bob_ws},
        headers=auth(alice_token),
    )

    assert response.status_code == 403
    assert response.json()["error"] == "您不是该工作区的成员"


def test_owner_can_list_and_create_conversations_in_own_workspace(
    rest_client: TestClient,
) -> None:
    alice_token, _ = register(rest_client, "alice@example.com", "Alice")
    alice_ws = create_workspace(rest_client, alice_token, "alice-team")

    listing = rest_client.get(
        "/api/conversations",
        params={"workspace_id": alice_ws},
        headers=auth(alice_token),
    )
    assert listing.status_code == 200, listing.text

    created = rest_client.post(
        "/api/conversations",
        json={"workspace_id": alice_ws, "title": "private chat"},
        headers=auth(alice_token),
    )
    assert created.status_code == 201, created.text
    assert created.json()["data"]["workspace_id"] == alice_ws


def test_non_member_cannot_read_foreign_conversation(
    rest_client: TestClient,
) -> None:
    alice_token, _ = register(rest_client, "alice@example.com", "Alice")
    bob_token, _ = register(rest_client, "bob@example.com", "Bob")
    alice_ws = create_workspace(rest_client, alice_token, "alice-team")
    conversation = create_conversation(rest_client, alice_token, alice_ws)

    own_read = rest_client.get(
        f"/api/conversations/{conversation['id']}", headers=auth(alice_token)
    )
    assert own_read.status_code == 200, own_read.text

    denied = rest_client.get(
        f"/api/conversations/{conversation['id']}", headers=auth(bob_token)
    )
    assert denied.status_code == 403
    assert denied.json()["error"] == "您不是该工作区的成员"


def test_non_member_cannot_list_or_create_messages(rest_client: TestClient) -> None:
    alice_token, _ = register(rest_client, "alice@example.com", "Alice")
    bob_token, _ = register(rest_client, "bob@example.com", "Bob")
    alice_ws = create_workspace(rest_client, alice_token, "alice-team")
    conversation = create_conversation(rest_client, alice_token, alice_ws)

    list_denied = rest_client.get(
        f"/api/conversations/{conversation['id']}/messages",
        headers=auth(bob_token),
    )
    assert list_denied.status_code == 403

    write_denied = rest_client.post(
        f"/api/conversations/{conversation['id']}/messages",
        json={"sender_type": "user", "content": "hi"},
        headers=auth(bob_token),
    )
    assert write_denied.status_code == 403


def test_jwt_tasks_and_agents_require_membership_scope(
    rest_client: TestClient,
) -> None:
    alice_token, _ = register(rest_client, "alice@example.com", "Alice")
    bob_token, _ = register(rest_client, "bob@example.com", "Bob")
    alice_ws = create_workspace(rest_client, alice_token, "alice-team")

    for path in ("/api/tasks", "/api/agents"):
        missing_scope = rest_client.get(path, headers=auth(alice_token))
        assert missing_scope.status_code == 422
        assert missing_scope.json()["error"] == "workspace_id 为必填参数"

        foreign_ws = rest_client.get(
            path, params={"workspace_id": alice_ws}, headers=auth(bob_token)
        )
        assert foreign_ws.status_code == 403
        assert foreign_ws.json()["error"] == "您不是该工作区的成员"
