"""Tests for plugin tool integration into the agent tool execution loop.

Covers runtime discovery, Function Calling spec injection, executor dispatch
with a trusted workspace id, cross-workspace isolation, honest failure when no
executor is registered, and the existing continue-on-error behavior.
"""

from __future__ import annotations

import json

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from unittest.mock import AsyncMock, patch

from app.core.orchestrator import AgentOrchestrator
from app.db.base import Base
from app.models import (
    Agent,
    Conversation,
    Plugin,
    Task,
    TaskStatus,
    TaskStep,
    Workspace,
    WorkspacePlugin,
)
from app.services.litellm_service import ChatCompletionResult, TokenUsage
from app.services.tools import (
    build_plugin_tool_specs,
    execute_tool,
    get_tools_spec,
    get_workspace_tools_spec,
    load_active_plugin_tools,
    register_plugin_tool_executor,
    unregister_plugin_tool_executor,
)


class RecordingBroadcaster:
    def __init__(self) -> None:
        self.events: list[tuple[int, dict]] = []

    async def broadcast_to_workspace(self, workspace_id: int, event: dict) -> None:
        self.events.append((workspace_id, event))


def completion(
    content: str,
    tool_calls: list[dict] | None = None,
) -> ChatCompletionResult:
    return ChatCompletionResult(
        content=content,
        usage=TokenUsage(prompt_tokens=8, completion_tokens=3, total_tokens=11),
        provider="deepseek",
        model_name="deepseek/deepseek-chat",
        requested_model="code_model",
        latency_ms=15,
        fallback_used=False,
        tool_calls=tool_calls or [],
    )


async def create_task_graph(session) -> tuple[Agent, Task]:
    workspace = Workspace(name="Plugin tools workspace", description="tests")
    session.add(workspace)
    await session.flush()
    agent = Agent(
        workspace_id=workspace.id,
        name="Executor",
        role="worker",
        model_name="code_model",
        system_prompt="Return a concise implementation result.",
        status="idle",
    )
    conversation = Conversation(workspace_id=workspace.id, title="Task chat")
    session.add_all([agent, conversation])
    await session.flush()
    task = Task(
        workspace_id=workspace.id,
        conversation_id=conversation.id,
        title="Run plugin tool",
        description="Use the available plugin tools and report the result.",
        assigned_agent_id=agent.id,
        status=TaskStatus.PENDING,
    )
    session.add(task)
    await session.commit()
    return agent, task


async def enable_plugin(
    session,
    workspace_id: int,
    plugin_name: str,
    tools: list[dict],
    *,
    base_url: str | None = None,
    config: dict | None = None,
) -> tuple[Plugin, WorkspacePlugin]:
    manifest = {
        "name": plugin_name,
        "display_name": plugin_name,
        "version": "1.0.0",
        "tools": tools,
    }
    if base_url:
        manifest["base_url"] = base_url
    plugin = Plugin(
        name=plugin_name,
        display_name=plugin_name,
        manifest_json=json.dumps(manifest),
        is_public=True,
    )
    session.add(plugin)
    await session.flush()
    wp = WorkspacePlugin(
        workspace_id=workspace_id,
        plugin_id=plugin.id,
        is_enabled=True,
        config_json=json.dumps(config) if config else None,
    )
    session.add(wp)
    await session.commit()
    return plugin, wp


@pytest_asyncio.fixture
async def orchestrator_session(tmp_path):
    database_path = tmp_path / "plugin-tools-test.db"
    engine = create_async_engine(f"sqlite+aiosqlite:///{database_path.as_posix()}")
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with session_factory() as session:
        yield session
    await engine.dispose()


# ---------------------------------------------------------------------------
# Runtime discovery + spec building
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_load_active_plugin_tools_filters_disabled_and_other_workspaces(
    orchestrator_session,
) -> None:
    first = Workspace(name="First", description="first")
    second = Workspace(name="Second", description="second")
    orchestrator_session.add_all([first, second])
    await orchestrator_session.flush()

    await enable_plugin(
        orchestrator_session,
        first.id,
        "github-actions",
        [{"name": "trigger_workflow", "description": "run ci", "parameters": {}}],
        config={"api_token": "ghp_secret"},
    )
    plugin, wp = await enable_plugin(
        orchestrator_session,
        first.id,
        "jira",
        [{"name": "create_issue", "description": "create issue", "parameters": {}}],
    )
    # Disable the jira plugin so its tools must disappear.
    wp.is_enabled = False
    await orchestrator_session.commit()

    first_tools = await load_active_plugin_tools(orchestrator_session, first.id)
    second_tools = await load_active_plugin_tools(orchestrator_session, second.id)

    assert [t["name"] for t in first_tools] == ["trigger_workflow"]
    assert first_tools[0]["plugin_name"] == "github-actions"
    assert first_tools[0]["config"] == {"api_token": "ghp_secret"}
    assert second_tools == []


def test_build_plugin_tool_specs_handles_flat_and_schema_parameters() -> None:
    records = [
        {
            "name": "trigger_workflow",
            "description": "run ci",
            "parameters": {"repo": "string", "workflow_id": "string"},
            "plugin_name": "github-actions",
            "base_url": None,
            "endpoint": "/run",
            "method": "POST",
            "config": {},
        },
        {
            "name": "query",
            "description": "",
            "parameters": {
                "type": "object",
                "properties": {"limit": {"type": "integer"}},
                "required": ["limit"],
            },
            "plugin_name": "github-actions",
            "base_url": None,
            "endpoint": None,
            "method": "POST",
            "config": {},
        },
    ]
    specs = build_plugin_tool_specs(records)
    assert [s["function"]["name"] for s in specs] == ["trigger_workflow", "query"]
    assert specs[0]["type"] == "function"
    assert specs[0]["function"]["parameters"] == {
        "type": "object",
        "properties": {
            "repo": {"type": "string"},
            "workflow_id": {"type": "string"},
        },
    }
    assert specs[1]["function"]["description"].startswith("Plugin tool 'query'")


@pytest.mark.asyncio
async def test_get_workspace_tools_spec_merges_builtin_and_plugin(
    orchestrator_session,
) -> None:
    _, task = await create_task_graph(orchestrator_session)
    await enable_plugin(
        orchestrator_session,
        task.workspace_id,
        "github-actions",
        [{"name": "trigger_workflow", "description": "run ci", "parameters": {}}],
    )

    specs = await get_workspace_tools_spec(orchestrator_session, task.workspace_id)
    names = [s["function"]["name"] for s in specs]
    assert names == [s["function"]["name"] for s in get_tools_spec()] + [
        "trigger_workflow"
    ]


# ---------------------------------------------------------------------------
# Orchestrator loop: spec injection + dispatch + trusted workspace
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_orchestrator_injects_spec_and_dispatches_plugin_tool(
    orchestrator_session,
) -> None:
    agent, task = await create_task_graph(orchestrator_session)
    await enable_plugin(
        orchestrator_session,
        task.workspace_id,
        "github-actions",
        [
            {
                "name": "trigger_workflow",
                "description": "Trigger a workflow",
                "parameters": {"repo": "string", "workflow_id": "string"},
                "endpoint": "/workflows/run",
            }
        ],
        config={"api_token": "ghp_secret"},
    )

    dispatched: list[dict] = []

    async def fake_executor(*, record, arguments, workspace_id, session):
        dispatched.append(
            {"record": record, "arguments": arguments, "workspace_id": workspace_id}
        )
        return json.dumps({"ok": True, "repo": arguments.get("repo")})

    register_plugin_tool_executor("github-actions", fake_executor)
    try:
        broadcaster = RecordingBroadcaster()
        tool_call = {
            "id": "call_1",
            "name": "trigger_workflow",
            "arguments": json.dumps({"repo": "acme/app", "workflow_id": "build"}),
        }
        with patch(
            "app.core.orchestrator.litellm_service.chat_completion",
            new=AsyncMock(
                side_effect=[
                    completion("", tool_calls=[tool_call]),
                    completion("Workflow triggered."),
                ]
            ),
        ) as model_call:
            result = await AgentOrchestrator(
                orchestrator_session, broadcaster
            ).run_task(task.id)
    finally:
        unregister_plugin_tool_executor("github-actions")

    assert model_call.await_count == 2
    first_tools = model_call.await_args_list[0].kwargs["tools"]
    plugin_spec = next(
        s for s in first_tools if s["function"]["name"] == "trigger_workflow"
    )
    assert plugin_spec["function"]["parameters"]["properties"] == {
        "repo": {"type": "string"},
        "workflow_id": {"type": "string"},
    }
    # Built-in tools are still present.
    assert any(s["function"]["name"] == "calculate" for s in first_tools)

    assert len(dispatched) == 1
    assert dispatched[0]["workspace_id"] == task.workspace_id
    assert dispatched[0]["arguments"] == {"repo": "acme/app", "workflow_id": "build"}
    assert dispatched[0]["record"]["plugin_name"] == "github-actions"
    assert dispatched[0]["record"]["config"] == {"api_token": "ghp_secret"}
    assert dispatched[0]["record"]["endpoint"] == "/workflows/run"

    assert result.status == TaskStatus.COMPLETED
    assert result.result == "Workflow triggered."

    tool_steps = list(
        await orchestrator_session.scalars(
            select(TaskStep).where(
                TaskStep.task_id == task.id, TaskStep.step_name == "tool_call"
            )
        )
    )
    assert len(tool_steps) == 1
    assert tool_steps[0].status == "completed"
    assert '"ok": true' in (tool_steps[0].output or "")


@pytest.mark.asyncio
async def test_plugin_tools_do_not_leak_across_workspaces(orchestrator_session) -> None:
    _, first_task = await create_task_graph(orchestrator_session)
    await enable_plugin(
        orchestrator_session,
        first_task.workspace_id,
        "github-actions",
        [{"name": "trigger_workflow", "description": "run ci", "parameters": {}}],
    )

    # Second workspace has no plugins mounted.
    second_workspace = Workspace(name="Second", description="second")
    orchestrator_session.add(second_workspace)
    await orchestrator_session.flush()

    second_specs = await get_workspace_tools_spec(
        orchestrator_session, second_workspace.id
    )
    assert all(s["function"]["name"] != "trigger_workflow" for s in second_specs)

    result = await execute_tool(
        "trigger_workflow",
        "{}",
        session=orchestrator_session,
        workspace_id=second_workspace.id,
    )
    assert result == "Unknown tool: trigger_workflow"


@pytest.mark.asyncio
async def test_plugin_tool_ignores_model_injected_workspace_id(
    orchestrator_session,
) -> None:
    agent, task = await create_task_graph(orchestrator_session)
    await enable_plugin(
        orchestrator_session,
        task.workspace_id,
        "github-actions",
        [{"name": "trigger_workflow", "description": "run ci", "parameters": {}}],
    )

    seen: dict = {}

    async def fake_executor(*, record, arguments, workspace_id, session):
        seen["workspace_id"] = workspace_id
        seen["arguments"] = arguments
        return "ok"

    register_plugin_tool_executor("github-actions", fake_executor)
    try:
        result = await execute_tool(
            "trigger_workflow",
            json.dumps({"workspace_id": 999999, "foo": "bar"}),
            session=orchestrator_session,
            workspace_id=task.workspace_id,
        )
    finally:
        unregister_plugin_tool_executor("github-actions")

    assert result == "ok"
    assert seen["workspace_id"] == task.workspace_id
    assert seen["arguments"] == {"foo": "bar"}


# ---------------------------------------------------------------------------
# Failure isolation + honest execution boundary
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_plugin_tool_without_executor_returns_honest_error_and_continues(
    orchestrator_session,
) -> None:
    agent, task = await create_task_graph(orchestrator_session)
    await enable_plugin(
        orchestrator_session,
        task.workspace_id,
        "github-actions",
        [{"name": "trigger_workflow", "description": "run ci", "parameters": {}}],
    )

    broadcaster = RecordingBroadcaster()
    tool_call = {"id": "call_1", "name": "trigger_workflow", "arguments": "{}"}
    with patch(
        "app.core.orchestrator.litellm_service.chat_completion",
        new=AsyncMock(
            side_effect=[
                completion("", tool_calls=[tool_call]),
                completion("Moved on without the plugin result."),
            ]
        ),
    ) as model_call:
        result = await AgentOrchestrator(
            orchestrator_session, broadcaster
        ).run_task(task.id)

    assert model_call.await_count == 2
    assert result.status == TaskStatus.COMPLETED
    assert result.result == "Moved on without the plugin result."

    tool_steps = list(
        await orchestrator_session.scalars(
            select(TaskStep).where(
                TaskStep.task_id == task.id, TaskStep.step_name == "tool_call"
            )
        )
    )
    assert len(tool_steps) == 1
    # C-183: without a per-plugin executor the process-wide webhook executor
    # runs instead; this tool declares no endpoint/base_url, so it still
    # yields an honest error string (never a fabricated result) and the
    # loop continues.
    assert "no endpoint or base_url configured" in (tool_steps[0].output or "")


@pytest.mark.asyncio
async def test_plugin_tool_execution_exception_does_not_interrupt_loop(
    orchestrator_session,
) -> None:
    agent, task = await create_task_graph(orchestrator_session)
    await enable_plugin(
        orchestrator_session,
        task.workspace_id,
        "github-actions",
        [{"name": "trigger_workflow", "description": "run ci", "parameters": {}}],
    )

    async def broken_executor(*, record, arguments, workspace_id, session):
        raise RuntimeError("webhook timed out")

    register_plugin_tool_executor("github-actions", broken_executor)
    try:
        broadcaster = RecordingBroadcaster()
        tool_call = {"id": "call_1", "name": "trigger_workflow", "arguments": "{}"}
        with patch(
            "app.core.orchestrator.litellm_service.chat_completion",
            new=AsyncMock(
                side_effect=[
                    completion("", tool_calls=[tool_call]),
                    completion("Recovered after the plugin failure."),
                ]
            ),
        ):
            result = await AgentOrchestrator(
                orchestrator_session, broadcaster
            ).run_task(task.id)
    finally:
        unregister_plugin_tool_executor("github-actions")

    assert result.status == TaskStatus.COMPLETED
    assert result.result == "Recovered after the plugin failure."

    tool_steps = list(
        await orchestrator_session.scalars(
            select(TaskStep).where(
                TaskStep.task_id == task.id, TaskStep.step_name == "tool_call"
            )
        )
    )
    assert len(tool_steps) == 1
    assert "webhook timed out" in (tool_steps[0].output or "")


@pytest.mark.asyncio
async def test_plugin_tool_validates_argument_types(orchestrator_session) -> None:
    agent, task = await create_task_graph(orchestrator_session)
    await enable_plugin(
        orchestrator_session,
        task.workspace_id,
        "github-actions",
        [
            {
                "name": "trigger_workflow",
                "description": "run ci",
                "parameters": {"run_id": "integer"},
            }
        ],
    )

    result = await execute_tool(
        "trigger_workflow",
        json.dumps({"run_id": "not-a-number"}),
        session=orchestrator_session,
        workspace_id=task.workspace_id,
    )
    assert "must be of type 'integer'" in result
