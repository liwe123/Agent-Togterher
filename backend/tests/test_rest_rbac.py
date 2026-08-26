"""RBAC coverage for the legacy ``/api`` (rest_router) surface (C-159).

The legacy routes must behave exactly as before for static-token and
open-mode callers, while JWT callers are now subject to the same
workspace RBAC rules as the v1 API.
"""

from __future__ import annotations

import asyncio
from collections.abc import Iterator
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.config import get_settings
from app.db.base import Base
from app.db.session import get_db
from app.main import app
from app.services.litellm_service import ChatCompletionResult, TokenUsage


@pytest.fixture
def rest_client(tmp_path) -> Iterator[TestClient]:
    database_path = tmp_path / "rest-rbac-test.db"
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


def set_role(
    client: TestClient,
    owner_token: str,
    workspace_id: int,
    user_id: int,
    role: str,
) -> None:
    response = client.put(
        f"/api/v1/workspaces/{workspace_id}/members/{user_id}/role",
        json={"role": role},
        headers=auth(owner_token),
    )
    assert response.status_code == 200, response.text


def agent_payload(workspace_id: int, name: str = "Tester") -> dict:
    return {
        "workspace_id": workspace_id,
        "name": name,
        "role": "qa",
        "description": "Tests APIs",
        "model_name": "openai/test-model",
        "system_prompt": "Test carefully.",
    }


def first_workspace_id(client: TestClient, token: str) -> int:
    workspaces = client.get(
        "/api/v1/workspaces/my", headers=auth(token)
    ).json()["data"]
    return workspaces[0]["id"]


def test_open_mode_callers_without_jwt_keep_legacy_access(rest_client: TestClient) -> None:
    workspace = rest_client.post(
        "/api/workspaces", json={"name": "legacy-ws", "description": "t"}
    ).json()["data"]
    assert (
        rest_client.post("/api/agents", json=agent_payload(workspace["id"])).status_code
        == 201
    )
    task = rest_client.post(
        "/api/tasks",
        json={"workspace_id": workspace["id"], "title": "t", "description": "d"},
    ).json()["data"]
    assert rest_client.get(f"/api/tasks/{task['id']}").status_code == 200
    assert rest_client.post(f"/api/tasks/{task['id']}/cancel").status_code == 200
    assert rest_client.get("/api/provider-keys").status_code == 200
    assert (
        rest_client.put(
            "/api/provider-keys/testprov", json={"api_key": "sk-legacy"}
        ).status_code
        == 200
    )
    assert (
        rest_client.post(
            "/api/custom-models",
            json={"name": "m1", "provider": "openai", "model": "gpt-4o"},
        ).status_code
        == 201
    )


def test_static_token_callers_keep_legacy_access(rest_client: TestClient) -> None:
    settings = get_settings()
    original = settings.app_api_token
    settings.app_api_token = SecretStr("static-dev-token")
    try:
        headers = {"Authorization": "Bearer static-dev-token"}
        workspace = rest_client.post(
            "/api/workspaces",
            json={"name": "static-ws", "description": "t"},
            headers=headers,
        ).json()["data"]
        assert workspace["id"] > 0
        assert (
            rest_client.post(
                "/api/tasks",
                json={"workspace_id": workspace["id"], "title": "t", "description": "d"},
                headers=headers,
            ).status_code
            == 201
        )
        assert (
            rest_client.put(
                "/api/provider-keys/testprov",
                json={"api_key": "sk-static"},
                headers=headers,
            ).status_code
            == 200
        )
    finally:
        settings.app_api_token = original


def test_member_cannot_create_agent_until_promoted(rest_client: TestClient) -> None:
    owner_token, _ = register(rest_client, "owner@example.com", "Alice")
    member_token, member_id = register(rest_client, "bob@example.com", "Bob")
    workspace_id = first_workspace_id(rest_client, owner_token)

    denied = rest_client.post(
        "/api/agents",
        json=agent_payload(workspace_id),
        headers=auth(member_token),
    )
    assert denied.status_code == 403
    assert "权限不足" in denied.json()["error"]

    set_role(rest_client, owner_token, workspace_id, member_id, "admin")
    allowed = rest_client.post(
        "/api/agents",
        json=agent_payload(workspace_id),
        headers=auth(member_token),
    )
    assert allowed.status_code == 201, allowed.text


def test_cross_workspace_access_is_rejected(rest_client: TestClient) -> None:
    owner_token, _ = register(rest_client, "owner@example.com", "Alice")
    member_token, _ = register(rest_client, "bob@example.com", "Bob")
    other_ws = rest_client.post(
        "/api/v1/workspaces",
        json={"name": "ws-two", "description": "second"},
        headers=auth(owner_token),
    ).json()["data"]
    other_ws_id = other_ws["id"]

    created = rest_client.post(
        "/api/agents",
        json=agent_payload(other_ws_id, name="Outsider"),
        headers=auth(owner_token),
    )
    assert created.status_code == 201, created.text
    agent_id = created.json()["data"]["id"]

    read_denied = rest_client.get(f"/api/agents/{agent_id}", headers=auth(member_token))
    assert read_denied.status_code == 403
    assert "您不是该工作区的成员" in read_denied.json()["error"]

    list_denied = rest_client.get(
        "/api/agents", params={"workspace_id": other_ws_id}, headers=auth(member_token)
    )
    assert list_denied.status_code == 403

    write_denied = rest_client.patch(
        f"/api/agents/{agent_id}",
        json={"description": "hijack"},
        headers=auth(member_token),
    )
    assert write_denied.status_code == 403


def test_task_run_requires_member_and_cancel_rejects_viewer(
    rest_client: TestClient,
) -> None:
    owner_token, _ = register(rest_client, "owner@example.com", "Alice")
    member_token, member_id = register(rest_client, "bob@example.com", "Bob")
    viewer_token, viewer_id = register(rest_client, "carol@example.com", "Carol")
    workspace_id = first_workspace_id(rest_client, owner_token)
    set_role(rest_client, owner_token, workspace_id, viewer_id, "viewer")

    pending_for_viewer = rest_client.post(
        "/api/tasks",
        json={"workspace_id": workspace_id, "title": "v-task", "description": "d"},
        headers=auth(member_token),
    ).json()["data"]

    viewer_read = rest_client.get(
        f"/api/tasks/{pending_for_viewer['id']}", headers=auth(viewer_token)
    )
    assert viewer_read.status_code == 200

    run_denied = rest_client.post(
        f"/api/tasks/{pending_for_viewer['id']}/run", headers=auth(viewer_token)
    )
    assert run_denied.status_code == 403

    cancel_denied = rest_client.post(
        f"/api/tasks/{pending_for_viewer['id']}/cancel", headers=auth(viewer_token)
    )
    assert cancel_denied.status_code == 403

    set_role(rest_client, owner_token, workspace_id, member_id, "member")
    member_created = rest_client.post(
        "/api/tasks",
        json={"workspace_id": workspace_id, "title": "b-task", "description": "d"},
        headers=auth(member_token),
    )
    assert member_created.status_code == 201, member_created.text

    agent = rest_client.post(
        "/api/agents", json=agent_payload(workspace_id), headers=auth(owner_token)
    ).json()["data"]
    conversation = rest_client.post(
        "/api/conversations",
        json={"workspace_id": workspace_id, "title": "rbac chat"},
        headers=auth(owner_token),
    ).json()["data"]
    hub_result = rest_client.post(
        f"/api/conversations/{conversation['id']}/messages",
        json={"sender_type": "user", "content": "@Tester Execute this task"},
        headers=auth(member_token),
    )
    assert hub_result.status_code == 201, hub_result.text
    runnable_task_id = hub_result.json()["data"]["task"]["id"]

    with patch(
        "app.core.orchestrator.litellm_service.chat_completion",
        new=AsyncMock(
            return_value=ChatCompletionResult(
                content="Task executed successfully",
                usage=TokenUsage(8, 3, 11),
                provider="openai",
                model_name="openai/test-model",
                requested_model="openai/test-model",
                latency_ms=15,
                fallback_used=False,
            )
        ),
    ):
        completed = rest_client.post(
            f"/api/tasks/{runnable_task_id}/run", headers=auth(member_token)
        )
    assert completed.status_code == 200, completed.text
    assert completed.json()["data"]["status"] == "completed"

    cancelled_by_owner = rest_client.post(
        f"/api/tasks/{pending_for_viewer['id']}/cancel", headers=auth(owner_token)
    )
    assert cancelled_by_owner.status_code == 200


def test_provider_key_writes_require_admin(rest_client: TestClient) -> None:
    owner_token, _ = register(rest_client, "owner@example.com", "Alice")
    member_token, _ = register(rest_client, "bob@example.com", "Bob")
    viewer_token, viewer_id = register(rest_client, "carol@example.com", "Carol")
    workspace_id = first_workspace_id(rest_client, owner_token)
    set_role(rest_client, owner_token, workspace_id, viewer_id, "viewer")

    assert (
        rest_client.get("/api/provider-keys", headers=auth(viewer_token)).status_code
        == 200
    )
    assert (
        rest_client.get(
            "/api/provider-keys/deepseek", headers=auth(viewer_token)
        ).status_code
        == 200
    )

    member_write = rest_client.put(
        "/api/provider-keys/testprov",
        json={"api_key": "sk-bob"},
        headers=auth(member_token),
    )
    assert member_write.status_code == 403

    owner_write = rest_client.put(
        "/api/provider-keys/testprov",
        json={"api_key": "sk-alice"},
        headers=auth(owner_token),
    )
    assert owner_write.status_code == 200

    member_delete = rest_client.delete(
        "/api/provider-keys/testprov", headers=auth(member_token)
    )
    assert member_delete.status_code == 403

    owner_delete = rest_client.delete(
        "/api/provider-keys/testprov", headers=auth(owner_token)
    )
    assert owner_delete.status_code == 200


def test_custom_model_writes_require_admin(rest_client: TestClient) -> None:
    owner_token, _ = register(rest_client, "owner@example.com", "Alice")
    member_token, _ = register(rest_client, "bob@example.com", "Bob")
    viewer_token, viewer_id = register(rest_client, "carol@example.com", "Carol")
    workspace_id = first_workspace_id(rest_client, owner_token)
    set_role(rest_client, owner_token, workspace_id, viewer_id, "viewer")

    payload = {"name": "rbac-model", "provider": "openai", "model": "gpt-4o"}

    assert (
        rest_client.get("/api/custom-models", headers=auth(viewer_token)).status_code
        == 200
    )

    member_create = rest_client.post(
        "/api/custom-models", json=payload, headers=auth(member_token)
    )
    assert member_create.status_code == 403

    owner_create = rest_client.post(
        "/api/custom-models", json=payload, headers=auth(owner_token)
    )
    assert owner_create.status_code == 201, owner_create.text

    member_delete = rest_client.delete(
        "/api/custom-models/rbac-model", headers=auth(member_token)
    )
    assert member_delete.status_code == 403

    owner_delete = rest_client.delete(
        "/api/custom-models/rbac-model", headers=auth(owner_token)
    )
    assert owner_delete.status_code == 200
