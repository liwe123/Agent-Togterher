import asyncio

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker

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
            "execution_token",
            "execution_token_expires_at",
        },
        "task_queue_items": {
            "id",
            "task_id",
            "status",
            "priority",
            "attempt_count",
            "max_attempts",
            "timeout_seconds",
            "available_at",
            "lease_token",
            "lease_expires_at",
            "last_error",
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
            "node_id",
            "dependencies_json",
            "order_index",
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
        "users": {
            "id",
            "email",
            "password_hash",
            "display_name",
            "avatar",
            "is_active",
            "created_at",
            "last_login_at",
        },
        "workspace_memberships": {
            "id",
            "user_id",
            "workspace_id",
            "role",
            "joined_at",
        },
        "workspace_invitations": {
            "id",
            "workspace_id",
            "inviter_id",
            "invitee_email",
            "invite_code",
            "role",
            "status",
            "expires_at",
            "created_at",
        },
        "audit_logs": {
            "id",
            "workspace_id",
            "user_id",
            "action",
            "resource_type",
            "resource_id",
            "detail",
            "ip_address",
            "created_at",
        },
        "quota_configs": {
            "id",
            "workspace_id",
            "monthly_budget_usd",
            "max_monthly_tokens",
            "max_concurrent_tasks",
            "rate_limit_per_minute",
            "is_hard_limit",
            "created_at",
            "updated_at",
        },
        "plugins": {
            "id",
            "name",
            "display_name",
            "description",
            "version",
            "icon",
            "author",
            "manifest_json",
            "is_public",
            "created_by_user_id",
            "created_at",
            "updated_at",
        },
        "workspace_plugins": {
            "id",
            "workspace_id",
            "plugin_id",
            "is_enabled",
            "config_json",
            "created_at",
            "updated_at",
        },
        "integration_nodes": {
            "id",
            "workspace_id",
            "name",
            "provider",
            "mode",
            "status",
            "version",
            "capabilities_json",
            "endpoint",
            "config_json",
            "last_heartbeat_at",
            "current_task_count",
            "max_concurrency",
            "created_at",
            "updated_at",
        },
        "refresh_tokens": {
            "id",
            "user_id",
            "jti",
            "expires_at",
            "revoked_at",
            "created_at",
        },
        "workflow_templates": {
            "id",
            "workspace_id",
            "name",
            "display_name",
            "description",
            "icon",
            "nodes_json",
            "variables_json",
            "is_system",
            "created_at",
            "updated_at",
        },
        "workflow_runs": {
            "id",
            "template_id",
            "task_id",
            "status",
            "snapshot_nodes_json",
            "created_at",
            "updated_at",
        },
    }

    assert set(Base.metadata.tables) == set(expected_columns)
    for table_name, columns in expected_columns.items():
        assert set(Base.metadata.tables[table_name].columns.keys()) == columns


def test_seed_is_idempotent(db_session_factory: async_sessionmaker) -> None:
    async def run_test() -> None:
        async with db_session_factory() as session:
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
