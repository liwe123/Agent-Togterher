"""Unit tests for CodexBridge configuration behaviour (P1 hardening).

These tests mock the subprocess layer so they never invoke the real Codex
CLI. They verify that:

* ``BRIDGE_CODEX_SKIP_GIT_CHECK`` controls whether ``--skip-git-repo-check``
  is appended to the command.
* ``BRIDGE_CODEX_TIMEOUT_SECONDS`` controls the wait timeout, and on timeout
  the process tree is reaped via ``_kill_process_tree``.
* ``_kill_process_tree`` is safe to call on an already-dead process.
"""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.services.bridge import BridgeTask
from app.services.codex_bridge import CodexBridge, _kill_process_tree


def _make_task(tmp_path) -> BridgeTask:
    return BridgeTask(
        task_id=1,
        task_title="t",
        task_description="d",
        workspace_id=1,
        task_workdir=tmp_path,
        prompt_path=tmp_path / "PROMPT.md",
        task_json_path=tmp_path / "task.json",
        output_path=tmp_path / "output.md",
        events_path=tmp_path / "events.jsonl",
    )


def _fake_settings(tmp_path, *, skip: bool, timeout: int) -> MagicMock:
    fake = MagicMock()
    fake.bridge_root_dir = str(tmp_path)
    fake.bridge_codex_skip_git_check = skip
    fake.bridge_codex_timeout_seconds = timeout
    return fake


def _patch_subprocess(monkeypatch, captured: dict, *, hang: bool = False):
    """Replace asyncio.create_subprocess_exec with a capturing fake."""

    async def fake_exec(*args, **kwargs):
        captured["cmd"] = list(args)
        proc = AsyncMock()
        proc.pid = 12345
        proc.returncode = 0
        if hang:
            async def hang_forever():
                await asyncio.sleep(1000)
            proc.communicate.side_effect = hang_forever
        else:
            proc.communicate.return_value = (b"done", b"events")
        return proc

    monkeypatch.setattr(
        "app.services.codex_bridge.asyncio.create_subprocess_exec", fake_exec
    )


@pytest.mark.asyncio
async def test_skip_git_check_true_appends_flag(tmp_path, monkeypatch):
    monkeypatch.setattr(
        "app.services.codex_bridge.get_settings",
        lambda: _fake_settings(tmp_path, skip=True, timeout=300),
    )
    captured: dict = {}
    _patch_subprocess(monkeypatch, captured)

    bridge = CodexBridge(workspace_id=1, node_name="codex-test")
    await bridge.execute(_make_task(tmp_path))

    assert "--skip-git-repo-check" in captured["cmd"]


@pytest.mark.asyncio
async def test_skip_git_check_false_omits_flag(tmp_path, monkeypatch):
    monkeypatch.setattr(
        "app.services.codex_bridge.get_settings",
        lambda: _fake_settings(tmp_path, skip=False, timeout=300),
    )
    captured: dict = {}
    _patch_subprocess(monkeypatch, captured)

    bridge = CodexBridge(workspace_id=1, node_name="codex-test")
    await bridge.execute(_make_task(tmp_path))

    assert "--skip-git-repo-check" not in captured["cmd"]


@pytest.mark.asyncio
async def test_timeout_uses_config_and_kills_tree(tmp_path, monkeypatch):
    monkeypatch.setattr(
        "app.services.codex_bridge.get_settings",
        lambda: _fake_settings(tmp_path, skip=True, timeout=1),
    )
    captured: dict = {}
    _patch_subprocess(monkeypatch, captured, hang=True)

    killed: dict = {}

    async def fake_kill(proc):
        killed["called"] = True
        killed["pid"] = proc.pid

    monkeypatch.setattr("app.services.codex_bridge._kill_process_tree", fake_kill)

    bridge = CodexBridge(workspace_id=1, node_name="codex-test")
    result = await bridge.execute(_make_task(tmp_path))

    assert result.success is False
    assert "timed out" in result.message
    assert "1s" in result.message
    assert killed.get("called") is True
    assert killed.get("pid") == 12345


@pytest.mark.asyncio
async def test_kill_process_tree_safe_on_dead_process():
    """_kill_process_tree must not raise when the process is already gone."""
    proc = AsyncMock()
    proc.pid = 999999999
    # Simulate kill raising because the process is already dead.
    proc.kill.side_effect = ProcessLookupError()
    proc.wait.return_value = -1
    # Should not raise.
    await _kill_process_tree(proc)
