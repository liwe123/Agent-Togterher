"""Tests for the workspace snapshot sent to a freshly connected WebSocket client."""

from collections.abc import Iterator
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.config import get_settings
from app.db.base import Base
from app.db.session import get_db
from app.main import app
from app.models import (
    Agent,
    Conversation,
    Message,
    MessageType,
    SenderType,
    Task,
    TaskStatus,
    Workspace,
)


@pytest.fixture
def ws_client(tmp_path) -> Iterator[TestClient]:
    database_path = tmp_path / "ws-snapshot-test.db"
    engine = create_async_engine(f"sqlite+aiosqlite:///{database_path.as_posix()}")
    session_factory = async_sessionmaker(engine, expire_on_commit=False)

    async def create_schema() -> None:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)

    async def seed_workspace() -> None:
        async with session_factory() as session:
            workspace = Workspace(id=1, name="snapshot-workspace", description="")
            agent = Agent(
                workspace_id=1,
                name="snapshot-agent",
                role="assistant",
                model_name="test-model",
                system_prompt="test",
            )
            conversation = Conversation(id=1, workspace_id=1, title="snapshot-chat")
            session.add_all([workspace, agent, conversation])
            await session.flush()
            task = Task(
                workspace_id=1,
                conversation_id=1,
                assigned_agent_id=agent.id,
                title="snapshot task",
                status=TaskStatus.RUNNING,
            )
            message = Message(
                conversation_id=1,
                sender_type=SenderType.USER,
                content="hello snapshot",
                message_type=MessageType.NORMAL,
            )
            session.add_all([task, message])
            await session.commit()

    async def override_get_db():
        async with session_factory() as session:
            yield session

    import asyncio

    asyncio.run(create_schema())
    asyncio.run(seed_workspace())
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


def test_snapshot_is_first_message_on_connect(ws_client: TestClient, settings) -> None:
    settings.app_api_token = None
    with ws_client.websocket_connect("/ws/workspaces/1") as websocket:
        event = websocket.receive_json()

    assert event["type"] == "workspace.snapshot"
    payload = event["payload"]
    assert payload["workspace_id"] == 1
    for key in ("tasks", "agents", "recent_messages"):
        assert key in payload

    assert [task["title"] for task in payload["tasks"]] == ["snapshot task"]
    assert payload["tasks"][0]["status"] == "running"
    assert payload["agents"][0]["name"] == "snapshot-agent"
    assert payload["recent_messages"][0]["content"] == "hello snapshot"


def test_snapshot_not_broadcast_to_other_clients(
    ws_client: TestClient, settings
) -> None:
    settings.app_api_token = None
    with ws_client.websocket_connect("/ws/workspaces/1") as first:
        assert first.receive_json()["type"] == "workspace.snapshot"
        with ws_client.websocket_connect("/ws/workspaces/1") as second:
            assert second.receive_json()["type"] == "workspace.snapshot"
            # No further pending events: the snapshot went only to the new client.
            first.send_text("ping")
            second.send_text("ping")
