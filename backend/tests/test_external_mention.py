from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from unittest.mock import patch

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base
from app.models import Conversation, IntegrationNode, TaskStep, Workspace
from app.services.bridge import BridgeResult
from app.services.cursor_bridge import CursorBridge


@pytest.mark.asyncio
async def test_mention_routes_to_integration_node(tmp_path, monkeypatch) -> None:
    """A group-chat ``@Cursor`` mention must dispatch to a Cursor integration
    node (creating a ``integration_dispatch:cursor:Cursor`` TaskStep) instead of
    an internal agent.
    """
    database_path = tmp_path / "external-mention.db"
    engine = create_async_engine(f"sqlite+aiosqlite:///{database_path.as_posix()}")
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    # Route the background node dispatch to the same test database.
    import app.core.message_hub as message_hub_module
    import app.db.session as session_module

    monkeypatch.setattr(message_hub_module, "AsyncSessionLocal", factory)
    monkeypatch.setattr(session_module, "AsyncSessionLocal", factory)

    # Let the real bridge layer run, but make execute write output.md so the
    # polling loop in CursorBridge completes immediately.
    async def fake_execute(self, task):
        task.output_path.write_text("Cursor 已完成任务", encoding="utf-8")
        return BridgeResult(
            success=True,
            message="Cursor 已完成任务",
            artifacts=[task.output_path],
            metadata={"node": self.node_name, "mode": "bridge"},
        )

    monkeypatch.setattr(CursorBridge, "execute", fake_execute)

    async with factory() as session:
        workspace = Workspace(name="external-ws", description="external workspace")
        session.add(workspace)
        await session.flush()
        node = IntegrationNode(
            workspace_id=workspace.id,
            name="Cursor",
            provider="cursor",
            mode="bridge",
            status="online",
            current_task_count=0,
            max_concurrency=1,
        )
        session.add(node)
        conversation = Conversation(workspace_id=workspace.id, title="group chat")
        session.add(conversation)
        await session.commit()
        await session.refresh(conversation)
        await session.refresh(node)

        hub = message_hub_module.MessageHub(session)
        result = await hub.receive_user_message(
            conversation.id, "@Cursor 帮我写一个排序函数"
        )

    # The node dispatch runs asynchronously on the loop; wait for the step.
    step = None
    for _ in range(100):
        await asyncio.sleep(0.05)
        async with factory() as poll_session:
            steps = list(
                await poll_session.scalars(
                    select(TaskStep).where(TaskStep.task_id == result.task.id)
                )
            )
            if steps:
                step = steps[0]
                break

    assert step is not None
    assert step.step_name == "integration_dispatch:cursor:Cursor"
    # Node-routed tasks are not assigned to an internal agent.
    assert result.assigned_agent is None

    await engine.dispose()


@pytest.mark.asyncio
async def test_cursor_bridge_execute_success(tmp_path) -> None:
    """CursorBridge returns success once the external client writes output.md."""
    node = CursorBridge(1, "Cursor")
    prepared = node.prepare_task(101, "标题", "描述")
    # Simulate the real Cursor client writing the result file.
    prepared.output_path.write_text("hello from cursor", encoding="utf-8")

    result = await node.execute(prepared)

    assert result.success is True
    assert result.message == "hello from cursor"
    assert prepared.output_path in (result.artifacts or [])


@pytest.mark.asyncio
async def test_cursor_bridge_execute_timeout(tmp_path, monkeypatch) -> None:
    """CursorBridge reports failure when output.md is never written."""

    class _FakeSettings:
        bridge_output_poll_timeout_seconds = 0.5

    # Shorten the poll so the test finishes quickly without changing real config.
    monkeypatch.setattr(
        "app.services.cursor_bridge.get_settings", lambda: _FakeSettings()
    )
    monkeypatch.setattr("app.services.cursor_bridge.POLL_INTERVAL_SECONDS", 0.1)

    node = CursorBridge(1, "Cursor")
    prepared = node.prepare_task(102, "标题", "描述")
    # Do NOT write output.md -> polling must time out.

    result = await node.execute(prepared)

    assert result.success is False
    assert "output.md" in result.message
