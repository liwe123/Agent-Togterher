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
from app.core.message_hub import parse_mentions
from app.main import app
from app.services.litellm_service import ChatCompletionResult
from app.services.litellm_service import LiteLLMUnavailableError
from app.services.litellm_service import ModelAttemptFailure
from app.services.litellm_service import ModelCallError
from app.services.litellm_service import TokenUsage
from app.services.tools import get_tools_spec


@pytest.fixture
def api_client(tmp_path) -> Iterator[TestClient]:
    database_path = tmp_path / "api-test.db"
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
        asyncio.run(engine.dispose())


def assert_success(response, status_code: int = 200):
    assert response.status_code == status_code, response.text
    body = response.json()
    assert body["success"] is True
    assert "data" in body
    return body["data"]


def create_workspace(client: TestClient, name: str = "API workspace") -> dict:
    return assert_success(
        client.post(
            "/api/workspaces",
            json={"name": name, "description": "Integration test workspace"},
        ),
        201,
    )


def create_agent(client: TestClient, workspace_id: int, name: str = "Tester") -> dict:
    return assert_success(
        client.post(
            "/api/agents",
            json={
                "workspace_id": workspace_id,
                "name": name,
                "role": "qa",
                "description": "Tests APIs",
                "model_name": "openai/test-model",
                "system_prompt": "Test carefully.",
            },
        ),
        201,
    )


def create_conversation(client: TestClient, workspace_id: int) -> dict:
    return assert_success(
        client.post(
            "/api/conversations",
            json={"workspace_id": workspace_id, "title": "API test chat"},
        ),
        201,
    )


def test_api_token_protects_non_public_routes(api_client: TestClient) -> None:
    settings = get_settings()
    original = settings.app_api_token
    settings.app_api_token = SecretStr("test-api-token")
    try:
        assert api_client.get("/api/v1/health").status_code == 200
        unauthorized = api_client.get("/api/workspaces")
        assert unauthorized.status_code == 401
        assert unauthorized.json()["error"] == "Authentication required"
        authorized = api_client.get(
            "/api/workspaces",
            headers={"Authorization": "Bearer test-api-token"},
        )
        assert authorized.status_code == 200
    finally:
        settings.app_api_token = original


def test_workspace_endpoints_and_duplicate_error(api_client: TestClient) -> None:
    workspace = create_workspace(api_client)
    assert assert_success(api_client.get("/api/workspaces"))[0]["id"] == workspace["id"]
    assert assert_success(api_client.get(f"/api/workspaces/{workspace['id']}"))["name"] == "API workspace"

    duplicate = api_client.post(
        "/api/workspaces", json={"name": "API workspace", "description": "duplicate"}
    )
    assert duplicate.status_code == 409
    assert duplicate.json() == {
        "success": False,
        "error": "A workspace with this name already exists",
    }

    missing = api_client.get("/api/workspaces/99999")
    assert missing.status_code == 404
    assert missing.json() == {"success": False, "error": "Workspace not found"}


def test_agent_endpoints(api_client: TestClient) -> None:
    workspace = create_workspace(api_client)
    agent = create_agent(api_client, workspace["id"])

    listed = assert_success(
        api_client.get("/api/agents", params={"workspace_id": workspace["id"]})
    )
    assert [item["id"] for item in listed] == [agent["id"]]
    assert assert_success(api_client.get(f"/api/agents/{agent['id']}"))["role"] == "qa"
    assert assert_success(api_client.get(f"/api/agents/{agent['id']}/status"))["status"] == "idle"

    updated = assert_success(
        api_client.patch(
            f"/api/agents/{agent['id']}",
            json={"status": "busy", "description": "Running tests"},
        )
    )
    assert updated["status"] == "busy"
    assert updated["description"] == "Running tests"


def test_conversation_and_message_endpoints(api_client: TestClient) -> None:
    workspace = create_workspace(api_client)
    agent = create_agent(api_client, workspace["id"])
    conversation = create_conversation(api_client, workspace["id"])

    listed = assert_success(
        api_client.get(
            "/api/conversations", params={"workspace_id": workspace["id"]}
        )
    )
    assert listed[0]["id"] == conversation["id"]
    assert assert_success(
        api_client.get(f"/api/conversations/{conversation['id']}")
    )["title"] == "API test chat"

    forged = api_client.post(
        f"/api/conversations/{conversation['id']}/messages",
        json={
            "sender_type": "agent",
            "sender_id": agent["id"],
            "content": "Test complete",
            "message_type": "receipt",
        },
    )
    assert forged.status_code == 403

    user_result = assert_success(
        api_client.post(
            f"/api/conversations/{conversation['id']}/messages",
            json={"sender_type": "user", "content": "@Tester Test complete"},
        ),
        201,
    )
    messages = assert_success(
        api_client.get(f"/api/conversations/{conversation['id']}/messages")
    )
    assert messages == [user_result["message"]]


def test_task_endpoints(api_client: TestClient) -> None:
    workspace = create_workspace(api_client)
    agent = create_agent(api_client, workspace["id"])
    conversation = create_conversation(api_client, workspace["id"])
    hub_result = assert_success(
        api_client.post(
            f"/api/conversations/{conversation['id']}/messages",
            json={"sender_type": "user", "content": "@Tester Please test it"},
        ),
        201,
    )
    message = hub_result["message"]
    assert hub_result["assigned_agent"]["id"] == agent["id"]
    assert hub_result["task"]["input_message_id"] == message["id"]

    task = assert_success(
        api_client.post(
            "/api/tasks",
            json={
                "workspace_id": workspace["id"],
                "conversation_id": conversation["id"],
                "title": "Run API tests",
                "assigned_agent_id": agent["id"],
                "input_message_id": message["id"],
                "priority": "high",
            },
        ),
        201,
    )
    assert task["status"] == "pending"
    listed_task = assert_success(api_client.get("/api/tasks"))[0]
    assert listed_task["id"] == task["id"]
    assert listed_task["assigned_agent"]["name"] == "Tester"

    detail = assert_success(api_client.get(f"/api/tasks/{task['id']}"))
    assert detail["priority"] == "high"
    assert detail["assigned_agent"]["id"] == agent["id"]
    assert detail["original_input"] == "@Tester Please test it"
    assert detail["task_steps"] == []
    assert detail["model_calls"] == []
    assert detail["token_usage"] == {
        "prompt_tokens": 0,
        "completion_tokens": 0,
        "total_tokens": 0,
    }
    assert detail["duration_ms"] is None

    forbidden_state = api_client.patch(
        f"/api/tasks/{task['id']}",
        json={"status": "completed", "result": "All tests passed"},
    )
    assert forbidden_state.status_code == 422

    updated = assert_success(
        api_client.patch(f"/api/tasks/{task['id']}", json={"priority": "low"})
    )
    assert updated["status"] == "pending"
    assert updated["priority"] == "low"


def test_task_run_endpoint_executes_agent_and_returns_result(
    api_client: TestClient,
) -> None:
    workspace = create_workspace(api_client)
    agent = create_agent(api_client, workspace["id"])
    conversation = create_conversation(api_client, workspace["id"])
    hub_result = assert_success(
        api_client.post(
            f"/api/conversations/{conversation['id']}/messages",
            json={"sender_type": "user", "content": "@Tester Execute this task"},
        ),
        201,
    )
    task_id = hub_result["task"]["id"]

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
    ) as model_call:
        completed = assert_success(api_client.post(f"/api/tasks/{task_id}/run"))

    model_call.assert_awaited_once_with(
        "openai/test-model",
        [
            {"role": "system", "content": "Test carefully."},
            {"role": "user", "content": "@Tester Execute this task"},
        ],
        tools=get_tools_spec(),
        api_keys={},
        custom_models={},
    )
    assert completed["status"] == "completed"
    assert completed["result"] == "Task executed successfully"
    detail = assert_success(api_client.get(f"/api/tasks/{task_id}"))
    assert detail["original_input"] == "@Tester Execute this task"
    assert detail["duration_ms"] >= 0
    assert len(detail["task_steps"]) == 1
    assert detail["task_steps"][0]["agent"]["name"] == "Tester"
    assert detail["task_steps"][0]["input"] == "@Tester Execute this task"
    assert detail["task_steps"][0]["output"] == "Task executed successfully"
    assert detail["task_steps"][0]["status"] == "completed"
    assert detail["task_steps"][0]["duration_ms"] >= 0
    assert len(detail["model_calls"]) == 1
    assert detail["model_calls"][0]["agent"]["name"] == "Tester"
    assert detail["model_calls"][0]["total_tokens"] == 11
    assert detail["model_calls"][0]["latency_ms"] == 15
    assert detail["token_usage"] == {
        "prompt_tokens": 8,
        "completion_tokens": 3,
        "total_tokens": 11,
    }
    assert assert_success(api_client.get(f"/api/agents/{agent['id']}/status"))[
        "status"
    ] == "idle"
    messages = assert_success(
        api_client.get(f"/api/conversations/{conversation['id']}/messages")
    )
    assert [message["sender_type"] for message in messages] == ["user", "agent"]
    assert messages[-1]["content"] == "Task executed successfully"

    rerun = api_client.post(f"/api/tasks/{task_id}/run")
    assert rerun.status_code == 409
    assert "cannot be started" in rerun.json()["error"]


def test_list_endpoints_support_bounded_pagination(api_client: TestClient) -> None:
    workspace = create_workspace(api_client)
    agent = create_agent(api_client, workspace["id"])
    conversations = [
        create_conversation(api_client, workspace["id"])
        for _ in range(3)
    ]
    conversation = conversations[0]

    for index in range(3):
        assert_success(
            api_client.post(
                f"/api/conversations/{conversation['id']}/messages",
                json={
                    "sender_type": "user",
                    "content": f"@Tester message {index}",
                },
            ),
            201,
        )

    latest_messages = assert_success(
        api_client.get(
            f"/api/conversations/{conversation['id']}/messages",
            params={"limit": 2},
        )
    )
    assert [message["content"] for message in latest_messages] == [
        "@Tester message 1",
        "@Tester message 2",
    ]

    paged_conversations = assert_success(
        api_client.get(
            "/api/conversations",
            params={"workspace_id": workspace["id"], "limit": 2, "offset": 1},
        )
    )
    assert [item["id"] for item in paged_conversations] == [
        conversations[1]["id"],
        conversations[0]["id"],
    ]

    task_ids = []
    for index in range(3):
        task = assert_success(
            api_client.post(
                "/api/tasks",
                json={
                    "workspace_id": workspace["id"],
                    "conversation_id": conversation["id"],
                    "title": f"Task {index}",
                    "assigned_agent_id": agent["id"],
                },
            ),
            201,
        )
        task_ids.append(task["id"])

    paged_tasks = assert_success(
        api_client.get(
            "/api/tasks",
            params={"workspace_id": workspace["id"], "limit": 2, "offset": 1},
        )
    )
    assert [item["id"] for item in paged_tasks] == [task_ids[1], task_ids[0]]


def test_model_endpoints(api_client: TestClient) -> None:
    workspace = create_workspace(api_client)
    create_agent(api_client, workspace["id"])
    models = assert_success(api_client.get("/api/models"))
    assert any(model["name"] == "openai/test-model" for model in models)

    with patch(
        "app.api.v1.endpoints.models.litellm_service.chat_completion",
        new=AsyncMock(
            return_value=ChatCompletionResult(
                content="OK",
                usage=TokenUsage(5, 1, 6),
                provider="openai",
                model_name="openai/test-model",
                requested_model="openai/test-model",
                latency_ms=12,
                fallback_used=False,
            )
        ),
    ) as model_test:
        result = assert_success(
            api_client.post(
                "/api/models/test",
                json={"model_name": "openai/test-model", "prompt": "Ping"},
            )
        )

    model_test.assert_awaited_once_with(
        "openai/test-model",
        [{"role": "user", "content": "Ping"}],
        api_keys={},
        custom_models={},
    )
    assert result == {
        "requested_model": "openai/test-model",
        "model_name": "openai/test-model",
        "provider": "openai",
        "content": "OK",
        "response": "OK",
        "usage": {
            "prompt_tokens": 5,
            "completion_tokens": 1,
            "total_tokens": 6,
        },
        "latency_ms": 12,
        "fallback_used": False,
    }

    with patch(
        "app.api.v1.endpoints.models.litellm_service.chat_completion",
        new=AsyncMock(side_effect=LiteLLMUnavailableError("LiteLLM unavailable")),
    ):
        unavailable = api_client.post(
            "/api/models/test", json={"model_name": "openai/test-model"}
        )
    assert unavailable.status_code == 503
    assert unavailable.json() == {
        "success": False,
        "error": "LiteLLM unavailable",
    }


def test_custom_model_endpoints_and_model_config_integration(
    api_client: TestClient,
) -> None:
    payload = {
        "name": "my_analyst",
        "provider": "my-provider",
        "model": "custom-1",
        "purpose": "自定义分析模型",
        "fallback_model": "cheap_model",
    }
    created = assert_success(
        api_client.post("/api/custom-models", json=payload),
        201,
    )
    assert created["name"] == "my_analyst"
    assert created["purpose"] == "自定义分析模型"

    listed = assert_success(api_client.get("/api/custom-models"))
    assert [item["name"] for item in listed] == ["my_analyst"]

    duplicate = api_client.post("/api/custom-models", json=payload)
    assert duplicate.status_code == 409
    assert "already exists" in duplicate.json()["error"]

    configs = assert_success(api_client.get("/api/models/config"))
    custom_cfg = next(item for item in configs if item["name"] == "my_analyst")
    assert custom_cfg["provider"] == "my-provider"
    assert custom_cfg["model"] == "custom-1"
    assert custom_cfg["fallback_model"] == "cheap_model"

    models = assert_success(api_client.get("/api/models"))
    custom_model = next(item for item in models if item["name"] == "my_analyst")
    assert custom_model["provider"] == "my-provider"
    assert custom_model["configured"] is False

    deleted = assert_success(api_client.delete("/api/custom-models/my_analyst"))
    assert deleted == {"deleted": "my_analyst"}

    missing = api_client.delete("/api/custom-models/my_analyst")
    assert missing.status_code == 404
    assert "not found" in missing.json()["error"]

    after_delete = assert_success(api_client.get("/api/models/config"))
    assert all(item["name"] != "my_analyst" for item in after_delete)


def test_provider_keys_accept_any_custom_provider(api_client: TestClient) -> None:
    # PUT accepts a provider not in any preset list and normalizes casing.
    created = assert_success(
        api_client.put(
            "/api/provider-keys/MoonShot",
            json={"api_key": "sk-moonshot-test-key"},
        )
    )
    assert created == {"provider": "moonshot", "configured": True}

    # GET only returns masked metadata for the custom provider.
    revealed = assert_success(api_client.get("/api/provider-keys/moonshot"))
    assert revealed == {
        "provider": "moonshot",
        "configured": True,
        "masked_key": "****-key",
        "source": "database",
    }
    assert "sk-moonshot-test-key" not in api_client.get(
        "/api/provider-keys/moonshot"
    ).text

    # The list includes the custom provider (configured) and the DeepSeek preset.
    listed = assert_success(api_client.get("/api/provider-keys"))
    providers = {item["provider"]: item["configured"] for item in listed}
    assert providers["moonshot"] is True
    assert "deepseek" in providers

    # DELETE removes the DB row; the provider disappears from the list.
    deleted = assert_success(api_client.delete("/api/provider-keys/moonshot"))
    assert deleted["provider"] == "moonshot"
    assert deleted["configured"] is False
    after = assert_success(api_client.get("/api/provider-keys"))
    assert all(item["provider"] != "moonshot" for item in after)


def test_providers_status_includes_deepseek_and_db_providers(
    api_client: TestClient,
) -> None:
    assert_success(
        api_client.put(
            "/api/provider-keys/MoonShot",
            json={"api_key": "sk-moonshot-test-key"},
        )
    )
    statuses = assert_success(
        api_client.get("/api/models/providers/status")
    )
    status_by_provider = {item["provider"]: item["configured"] for item in statuses}
    assert "deepseek" in status_by_provider
    assert status_by_provider["moonshot"] is True


def test_validation_errors_are_wrapped(api_client: TestClient) -> None:
    response = api_client.post("/api/workspaces", json={"name": ""})
    assert response.status_code == 422
    body = response.json()
    assert body["success"] is False
    assert "body.name" in body["error"]


def test_message_hub_parses_chinese_mentions_and_defaults(
    api_client: TestClient,
) -> None:
    assert parse_mentions(
        "@项目总设计师 规划，@Agent工程师 实现；@项目总设计师 复核"
    ) == ["项目总设计师", "Agent工程师"]

    workspace = create_workspace(api_client)
    manager = create_agent(api_client, workspace["id"], "项目总设计师")
    engineer = create_agent(api_client, workspace["id"], "Agent工程师")
    conversation = create_conversation(api_client, workspace["id"])

    mentioned = assert_success(
        api_client.post(
            f"/api/conversations/{conversation['id']}/messages",
            json={
                "sender_type": "user",
                "content": "@Agent工程师 实现后端 API",
            },
        ),
        201,
    )
    assert mentioned["message"]["content"] == "@Agent工程师 实现后端 API"
    assert mentioned["assigned_agent"]["id"] == engineer["id"]
    assert mentioned["task"]["assigned_agent_id"] == engineer["id"]
    assert mentioned["task"]["status"] == "pending"
    assert mentioned["task"]["priority"] == "normal"
    assert mentioned["task"]["input_message_id"] == mentioned["message"]["id"]

    defaulted = assert_success(
        api_client.post(
            f"/api/conversations/{conversation['id']}/messages",
            json={"sender_type": "user", "content": "整理这次需求"},
        ),
        201,
    )
    assert defaulted["assigned_agent"]["id"] == manager["id"]
    assert defaulted["task"]["assigned_agent_id"] == manager["id"]


def test_message_hub_requires_default_agent_before_writing(
    api_client: TestClient,
) -> None:
    workspace = create_workspace(api_client)
    conversation = create_conversation(api_client, workspace["id"])

    response = api_client.post(
        f"/api/conversations/{conversation['id']}/messages",
        json={"sender_type": "user", "content": "No configured recipient"},
    )
    assert response.status_code == 422
    assert assert_success(
        api_client.get(f"/api/conversations/{conversation['id']}/messages")
    ) == []


def test_docs_and_openapi_are_available(api_client: TestClient) -> None:
    assert api_client.get("/docs").status_code == 200
    openapi = api_client.get("/openapi.json")
    assert openapi.status_code == 200
    paths = openapi.json()["paths"]
    assert "/api/workspaces" in paths
    assert "/api/models/test" in paths


def test_workspace_websocket_rejects_missing_workspace(
    api_client: TestClient,
) -> None:
    with api_client.websocket_connect("/ws/workspaces/99999") as websocket:
        assert websocket.receive_json() == {
            "type": "error",
            "payload": {"message": "Workspace not found"},
        }


def test_workspace_websocket_broadcasts_realtime_events(
    api_client: TestClient,
) -> None:
    workspace = create_workspace(api_client)
    agent = create_agent(api_client, workspace["id"])
    conversation = create_conversation(api_client, workspace["id"])

    with api_client.websocket_connect(
        f"/ws/workspaces/{workspace['id']}"
    ) as websocket:
        hub_result = assert_success(
            api_client.post(
                f"/api/conversations/{conversation['id']}/messages",
                json={
                    "sender_type": "user",
                    "content": "@Tester Start realtime test",
                },
            ),
            201,
        )
        message = hub_result["message"]
        assert websocket.receive_json() == {
            "type": "message.created",
            "payload": message,
        }
        assert websocket.receive_json() == {
            "type": "task.status_changed",
            "payload": hub_result["task"],
        }

        updated_agent = assert_success(
            api_client.patch(
                f"/api/agents/{agent['id']}",
                json={"status": "busy"},
            )
        )
        assert websocket.receive_json() == {
            "type": "agent.status_changed",
            "payload": {
                "id": agent["id"],
                "status": "busy",
                "last_active_at": updated_agent["last_active_at"],
            },
        }

        task = assert_success(
            api_client.post(
                "/api/tasks",
                json={
                    "workspace_id": workspace["id"],
                    "conversation_id": conversation["id"],
                    "title": "Realtime task",
                    "assigned_agent_id": agent["id"],
                    "input_message_id": message["id"],
                },
            ),
            201,
        )
        forbidden_state = api_client.patch(
            f"/api/tasks/{task['id']}",
            json={"status": "running"},
        )
        assert forbidden_state.status_code == 422

        with patch(
            "app.api.v1.endpoints.models.litellm_service.chat_completion",
            new=AsyncMock(
                return_value=ChatCompletionResult(
                    content="Realtime OK",
                    usage=TokenUsage(3, 2, 5),
                    provider="openai",
                    model_name="openai/test-model",
                    requested_model="openai/test-model",
                    latency_ms=9,
                    fallback_used=False,
                )
            ),
        ):
            model_result = assert_success(
                api_client.post(
                    "/api/models/test",
                    json={
                        "workspace_id": workspace["id"],
                        "model_name": "openai/test-model",
                        "prompt": "Ping",
                    },
                )
            )
        assert websocket.receive_json() == {
            "type": "model.call_finished",
            "payload": model_result,
        }

        with patch(
            "app.api.v1.endpoints.models.litellm_service.chat_completion",
            new=AsyncMock(
                side_effect=ModelCallError(
                    "openai/test-model",
                    [
                        ModelAttemptFailure(
                            provider="openai",
                            model_name="openai/test-model",
                            message="provider timeout",
                        )
                    ],
                )
            ),
        ):
            failed_model = api_client.post(
                "/api/models/test",
                json={
                    "workspace_id": workspace["id"],
                    "model_name": "openai/test-model",
                },
            )
        assert failed_model.status_code == 502
        assert websocket.receive_json() == {
            "type": "error",
            "payload": {
                "message": (
                    "Model test failed: All attempts for 'openai/test-model' failed "
                    "(openai/test-model: provider timeout)"
                )
            },
        }
