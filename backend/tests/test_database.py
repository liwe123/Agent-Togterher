import asyncio

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base
from app.db.seed import DEFAULT_AGENTS, seed_defaults
from app.models import Agent, Workspace


def test_all_required_tables_and_columns_are_registered() -> None:
    expected_columns = {
        "workspaces": {"id", "name", "description", "created_at"},
        "agents": {
            "id",
            "workspace_id",
            "name",
            "role",
            "description",
            "avatar",
            "model_name",
            "system_prompt",
            "status",
            "last_active_at",
            "created_at",
        },
        "conversations": {
            "id",
            "workspace_id",
            "title",
            "created_at",
            "updated_at",
        },
        "messages": {
            "id",
            "conversation_id",
            "sender_type",
            "sender_id",
            "content",
            "message_type",
            "created_at",
        },
        "tasks": {
            "id",
            "workspace_id",
            "conversation_id",
            "title",
            "description",
            "assigned_agent_id",
            "status",
            "priority",
            "input_message_id",
            "result",
            "created_at",
            "updated_at",
        },
        "task_steps": {
            "id",
            "task_id",
            "agent_id",
            "step_name",
            "input",
            "output",
            "status",
            "started_at",
            "finished_at",
        },
        "model_calls": {
            "id",
            "task_id",
            "agent_id",
            "model_name",
            "provider",
            "prompt_tokens",
            "completion_tokens",
            "cost",
            "latency_ms",
            "status",
            "error_message",
            "created_at",
        },
        "provider_credentials": {
            "id",
            "provider",
            "api_key",
            "created_at",
            "updated_at",
        },
        "custom_model_configs": {
            "id",
            "name",
            "provider",
            "model",
            "purpose",
            "fallback_model",
            "created_at",
            "updated_at",
        },
    }

    assert set(Base.metadata.tables) == set(expected_columns)
    for table_name, columns in expected_columns.items():
        assert set(Base.metadata.tables[table_name].columns.keys()) == columns


def test_seed_is_idempotent(tmp_path) -> None:
    async def run_test() -> None:
        database_path = tmp_path / "seed-test.db"
        engine = create_async_engine(f"sqlite+aiosqlite:///{database_path.as_posix()}")
        session_factory = async_sessionmaker(engine, expire_on_commit=False)

        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)

        async with session_factory() as session:
            assert await seed_defaults(session) == (True, len(DEFAULT_AGENTS))
            assert await seed_defaults(session) == (False, 0)
            workspace_count = await session.scalar(
                select(func.count()).select_from(Workspace)
            )
            agent_count = await session.scalar(select(func.count()).select_from(Agent))
            seeded_models = dict(
                (
                    await session.execute(
                        select(Agent.name, Agent.model_name).order_by(Agent.id)
                    )
                ).all()
            )

        await engine.dispose()
        assert workspace_count == 1
        assert agent_count == 6
        assert seeded_models == {
            "项目总设计师": "manager_model",
            "Agent工程师": "code_model",
            "前端设计师": "code_model",
            "知识库管理员": "writing_model",
            "测试专员": "review_model",
            "运维": "code_model",
        }

    asyncio.run(run_test())
