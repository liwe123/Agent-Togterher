import asyncio
from collections.abc import Iterator

import pytest
import pytest_asyncio
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.errors import AppError
from app.core.message_hub import MessageHub
from app.db.base import Base
from app.db.session import get_db
from app.main import app
from app.models import Agent, Conversation, Task, Workspace
from app.models.quota_config import QuotaConfig
from app.services.quota_service import reset_rate_limit_state


class RecordingBroadcaster:
    def __init__(self, log: list[tuple]) -> None:
        self.log = log

    async def broadcast_to_workspace(self, workspace_id: int, event: dict) -> None:
        self.log.append(("broadcast", workspace_id, event["type"], event.get("payload")))


@pytest.fixture(autouse=True)
def _reset_rate_limit():
    reset_rate_limit_state()
    yield
    reset_rate_limit_state()


@pytest_asyncio.fixture
async def hub_session(tmp_path):
    database_path = tmp_path / "quota-enforcement-hub.db"
    engine = create_async_engine(f"sqlite+aiosqlite:///{database_path.as_posix()}")
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with session_factory() as session:
        yield session
    await engine.dispose()


async def create_hub_graph(session, **quota_kwargs) -> tuple[Workspace, Conversation, Agent]:
    workspace = Workspace(name="Quota workspace", description="tests")
    session.add(workspace)
    await session.flush()
    agent = Agent(
        workspace_id=workspace.id,
        name="项目总设计师",
        role="project_architect",
        model_name="manager_model",
        system_prompt="Plan and dispatch work.",
        status="idle",
    )
    conversation = Conversation(workspace_id=workspace.id, title="Quota chat")
    session.add_all([agent, conversation])
    await session.flush()
    session.add(QuotaConfig(workspace_id=workspace.id, **quota_kwargs))
    await session.commit()
    return workspace, conversation, agent


def _noop_dispatcher(task_id: int) -> None:
    return None


async def _task_count(session) -> int:
    return int(await session.scalar(select(func.count(Task.id))) or 0)


@pytest.mark.asyncio
async def test_hard_limit_blocks_task_creation(hub_session) -> None:
    workspace, conversation, agent = await create_hub_graph(
        hub_session,
        monthly_budget_usd=0.0,
        is_hard_limit=True,
    )
    log: list[tuple] = []

    with pytest.raises(AppError) as exc_info:
        await MessageHub(
            hub_session,
            broadcaster=RecordingBroadcaster(log),
            dispatcher=_noop_dispatcher,
        ).receive_user_message(conversation.id, "触发硬熔断")

    assert exc_info.value.status_code == 429
    assert await _task_count(hub_session) == 0
    assert log == [("broadcast", workspace.id, "error", {"message": exc_info.value.message})]


@pytest.mark.asyncio
async def test_within_quota_allows_dispatch(hub_session) -> None:
    workspace, conversation, agent = await create_hub_graph(
        hub_session,
        monthly_budget_usd=100.0,
        is_hard_limit=True,
    )
    log: list[tuple] = []

    result = await MessageHub(
        hub_session,
        broadcaster=RecordingBroadcaster(log),
        dispatcher=_noop_dispatcher,
    ).receive_user_message(conversation.id, "正常派发")

    assert result.assigned_agent is not None
    assert result.assigned_agent.id == agent.id
    assert await _task_count(hub_session) == 1
    assert log[-1][1] == workspace.id


@pytest.mark.asyncio
async def test_soft_limit_allows_dispatch_when_exceeded(hub_session) -> None:
    workspace, conversation, agent = await create_hub_graph(
        hub_session,
        monthly_budget_usd=0.0,
        is_hard_limit=False,
    )
    log: list[tuple] = []

    result = await MessageHub(
        hub_session,
        broadcaster=RecordingBroadcaster(log),
        dispatcher=_noop_dispatcher,
    ).receive_user_message(conversation.id, "软限制仍放行")

    assert result.task.id is not None
    assert await _task_count(hub_session) == 1


@pytest.mark.asyncio
async def test_rate_limit_blocks_second_dispatch(hub_session) -> None:
    workspace, conversation, agent = await create_hub_graph(
        hub_session,
        rate_limit_per_minute=1,
    )
    log: list[tuple] = []
    hub = MessageHub(
        hub_session,
        broadcaster=RecordingBroadcaster(log),
        dispatcher=_noop_dispatcher,
    )

    first = await hub.receive_user_message(conversation.id, "第一次请求")
    assert first.task.id is not None

    with pytest.raises(AppError) as exc_info:
        await hub.receive_user_message(conversation.id, "第二次请求")
    assert exc_info.value.status_code == 429
    assert await _task_count(hub_session) == 1


@pytest.fixture
def workflow_client(tmp_path) -> Iterator[TestClient]:
    database_path = tmp_path / "quota-enforcement-workflows.db"
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


def _register_owner(client: TestClient) -> tuple[str, int]:
    res = client.post(
        "/api/v1/auth/register",
        json={
            "email": "quotaenforce@example.com",
            "password": "Password123!",
            "display_name": "Quota Enforce",
        },
    )
    assert res.status_code == 200
    token = res.json()["data"]["access_token"]
    ws_res = client.get(
        "/api/v1/workspaces/my",
        headers={"Authorization": f"Bearer {token}"},
    )
    ws_id = ws_res.json()["data"][0]["id"]
    return token, ws_id


def _system_template_id(client: TestClient, token: str, ws_id: int) -> int:
    list_res = client.get(
        f"/api/v1/workspaces/{ws_id}/workflows",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert list_res.status_code == 200
    templates = list_res.json()["data"]
    system_tpl = next(t for t in templates if t["is_system"])
    return system_tpl["id"]


def test_workflow_run_hard_limit_blocks(workflow_client: TestClient) -> None:
    token, ws_id = _register_owner(workflow_client)
    headers = {"Authorization": f"Bearer {token}"}
    tpl_id = _system_template_id(workflow_client, token, ws_id)

    put_res = workflow_client.put(
        f"/api/v1/workspaces/{ws_id}/quota",
        json={"monthly_budget_usd": 0.0, "is_hard_limit": True},
        headers=headers,
    )
    assert put_res.status_code == 200

    run_res = workflow_client.post(
        f"/api/v1/workspaces/{ws_id}/workflows/{tpl_id}/run",
        headers=headers,
        json={"variables": {}},
    )
    assert run_res.status_code == 429
    assert run_res.json()["success"] is False


def test_workflow_run_rate_limit_blocks(workflow_client: TestClient) -> None:
    token, ws_id = _register_owner(workflow_client)
    headers = {"Authorization": f"Bearer {token}"}
    tpl_id = _system_template_id(workflow_client, token, ws_id)

    put_res = workflow_client.put(
        f"/api/v1/workspaces/{ws_id}/quota",
        json={"rate_limit_per_minute": 1},
        headers=headers,
    )
    assert put_res.status_code == 200

    first = workflow_client.post(
        f"/api/v1/workspaces/{ws_id}/workflows/{tpl_id}/run",
        headers=headers,
        json={"variables": {}},
    )
    assert first.status_code == 200

    second = workflow_client.post(
        f"/api/v1/workspaces/{ws_id}/workflows/{tpl_id}/run",
        headers=headers,
        json={"variables": {}},
    )
    assert second.status_code == 429
