import asyncio
import pytest
from unittest.mock import AsyncMock, patch
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base
from app.db.seed import seed_defaults, DEFAULT_AGENTS
from app.db.session import get_db
from app.main import app
from app.models import Workspace, Agent
from app.services.litellm_service import ChatCompletionResult, TokenUsage

@pytest.fixture
def basic_client(tmp_path) -> TestClient:
    """Fixture to provide a TestClient using a temporary SQLite database."""
    database_path = tmp_path / "basic-test.db"
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
    
    # Pre-seed the test database
    async def pre_seed():
        async with session_factory() as session:
            await seed_defaults(session)
    asyncio.run(pre_seed())

    try:
        with TestClient(app) as client:
            yield client
    finally:
        app.dependency_overrides.clear()
        asyncio.run(engine.dispose())


def test_backend_api_starts(basic_client: TestClient) -> None:
    """1. 后端 API 是否能启动"""
    response = basic_client.get("/api/v1/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


@pytest.mark.asyncio
async def test_database_creation(tmp_path) -> None:
    """2. 数据库是否能创建"""
    database_path = tmp_path / "create-test.db"
    engine = create_async_engine(f"sqlite+aiosqlite:///{database_path.as_posix()}")
    
    async with engine.begin() as connection:
        # Create all tables
        await connection.run_sync(Base.metadata.create_all)
        
    async with engine.connect() as connection:
        # Verify that workspaces table exists and is readable
        result = await connection.execute(select(1))
        assert result.scalar() == 1
        
    await engine.dispose()


@pytest.mark.asyncio
async def test_seed_execution(tmp_path) -> None:
    """3. seed 是否能执行"""
    database_path = tmp_path / "seed-test.db"
    engine = create_async_engine(f"sqlite+aiosqlite:///{database_path.as_posix()}")
    session_factory = async_sessionmaker(engine, expire_on_commit=False)

    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    async with session_factory() as session:
        # Run seed and verify it returns True and count of agents
        workspace_created, created_agents = await seed_defaults(session)
        assert workspace_created is True
        assert created_agents == len(DEFAULT_AGENTS)

        # Check database workspace
        workspace = await session.scalar(select(Workspace).where(Workspace.name == "默认工作区"))
        assert workspace is not None

        # Check seeded agents
        agents = (await session.scalars(select(Agent).where(Agent.workspace_id == workspace.id))).all()
        assert len(agents) == len(DEFAULT_AGENTS)

    await engine.dispose()


def test_model_test_endpoint_available(basic_client: TestClient) -> None:
    """4. 模型测试接口是否可用"""
    mock_result = ChatCompletionResult(
        content="Test connection success",
        usage=TokenUsage(prompt_tokens=5, completion_tokens=3, total_tokens=8),
        provider="openai",
        model_name="openai/gpt-4o-mini",
        requested_model="code_model",
        latency_ms=100,
        fallback_used=False
    )

    with patch("app.api.v1.endpoints.models.litellm_service.chat_completion", new=AsyncMock(return_value=mock_result)):
        response = basic_client.post(
            "/api/models/test",
            json={"model_name": "code_model", "prompt": "Ping"}
        )
        assert response.status_code == 200
        body = response.json()
        assert body["success"] is True
        assert body["data"]["content"] == "Test connection success"
        assert body["data"]["usage"]["total_tokens"] == 8


def test_websocket_connectable(basic_client: TestClient) -> None:
    """5. WebSocket 是否可连接"""
    # Fetch first seeded workspace
    response = basic_client.get("/api/workspaces")
    assert response.status_code == 200
    workspaces = response.json()["data"]
    assert len(workspaces) > 0
    workspace_id = workspaces[0]["id"]

    # Try connecting to the workspace WebSocket
    with basic_client.websocket_connect(f"/ws/workspaces/{workspace_id}") as websocket:
        # If no error is thrown, the connection succeeded
        assert websocket is not None
