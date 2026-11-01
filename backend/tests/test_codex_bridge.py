"""Unit tests for CodexBridge execution behaviour (P1 hardening + budget).

These tests mock the subprocess layer so they never invoke the real Codex
CLI. They verify that:

* BRIDGE_CODEX_SKIP_GIT_CHECK controls whether --skip-git-repo-check is
  appended to the command.
* BRIDGE_CODEX_TIMEOUT_SECONDS controls the wait timeout, and on timeout the
  process tree is reaped via _kill_process_tree.
* _kill_process_tree is safe to call on an already-dead process.
* is_turn_started_event recognises every documented turn-start spelling and
  never raises on dirty lines.
* With budget_turns set, stderr is streamed line by line and the process tree
  is killed as soon as the budget_turns + 1-th turn starts; without a budget
  the historical communicate() path is unchanged.
"""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.services.bridge import BridgeTask
from app.services.codex_bridge import (
    STREAM_LIMIT_BYTES,
    CodexBridge,
    _kill_process_tree,
    is_turn_started_event,
)

TURN_EVENT = '{"type":"turn.started"}'
TURN_EVENT_UNDERSCORE = '{"type":"turn_started"}'
TURN_EVENT_WRAPPED = '{"id":"0","msg":{"type":"turn.started"}}'


def _make_task(
    tmp_path,
    *,
    budget_turns: int | None = None,
    cancel_event=None,
) -> BridgeTask:
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
        budget_turns=budget_turns,
        cancel_event=cancel_event,
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


class _FakeStreamingProcess:
    """Minimal asyncio.subprocess.Process stand-in with real stream readers.

    stderr/stdout are genuine StreamReader instances, so the bridge streams
    them exactly as it would from a child process. communicate() raises on
    purpose: the budget path must not fall back to buffering the streams.
    """

    def __init__(
        self,
        stderr_lines: list[str],
        *,
        stdout: bytes = b"",
        returncode: int = 0,
        pid: int = 4321,
        running: bool = False,
        close_stderr: bool = True,
    ) -> None:
        self.pid = pid
        self.returncode = returncode
        self.killed = False
        self._exited = asyncio.Event()
        if not running:
            self._exited.set()
        self.stderr = asyncio.StreamReader()
        self.stdout = asyncio.StreamReader()
        for line in stderr_lines:
            self.stderr.feed_data(line.encode("utf-8"))
        if close_stderr:
            self.stderr.feed_eof()
        self.stdout.feed_data(stdout)
        self.stdout.feed_eof()

    async def wait(self) -> int:
        await self._exited.wait()
        return self.returncode

    def mark_killed(self) -> None:
        self.killed = True
        self._exited.set()

    async def communicate(self):  # pragma: no cover - must never be used here
        raise AssertionError("budget path must stream stderr instead of buffering")

    async def kill(self) -> None:  # pragma: no cover - defensive stand-in
        self.mark_killed()


def _patch_streaming_subprocess(monkeypatch, proc, captured: dict) -> None:
    async def fake_exec(*args, **kwargs):
        captured["cmd"] = list(args)
        captured["kwargs"] = kwargs
        return proc

    monkeypatch.setattr(
        "app.services.codex_bridge.asyncio.create_subprocess_exec", fake_exec
    )


def _patch_kill(monkeypatch, killed: list[int]) -> None:
    async def fake_kill(proc):
        proc.mark_killed()
        killed.append(proc.pid)

    monkeypatch.setattr("app.services.codex_bridge._kill_process_tree", fake_kill)


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
async def test_kill_process_tree_safe_on_dead_process(monkeypatch):
    """_kill_process_tree must not raise when the process is already gone."""
    # _kill_process_tree 按 sys.platform 分叉（win32 走 taskkill，其他走 kill()），
    # 为保证断言在 Windows 与 Linux 上语义一致，本用例钉住非 win32 分支。
    monkeypatch.setattr("app.services.codex_bridge.sys.platform", "linux")
    # 真实契约：pid 与 kill() 是同步的，只有 wait() 是协程。此前整对象用
    # AsyncMock，kill() 会返回一个从未 await 的协程（ProcessLookupError 被推迟
    # 到 await 时才抛），兜底分支从未执行、协程被丢弃——CI（Linux）上表现为
    # PytestUnraisableExceptionWarning。本机 Windows 之所以没暴露，不是因为 GC
    # 时机，而是 _kill_process_tree 在 win32 分支走 taskkill、根本不调用 kill()，
    # 协程从未被创建；故本用例显式钉住非 win32 分支（独立验收 P1）。
    proc = MagicMock()
    proc.pid = 999999999
    # 模拟进程已死：同步 kill() 立即抛 ProcessLookupError。
    proc.kill.side_effect = ProcessLookupError()
    proc.wait = AsyncMock(return_value=-1)
    # Should not raise.
    await _kill_process_tree(proc)
    # 首次 kill() 抛错 → 走兜底再次 kill() → 仍抛错并被吞掉；wait() 被 await。
    assert proc.kill.call_count == 2
    proc.wait.assert_awaited_once()


@pytest.mark.parametrize(
    "line",
    [
        TURN_EVENT,
        '  {"type": "turn.started"}  ',
        TURN_EVENT + "\n",
        TURN_EVENT + "\r\n",  # Windows CRLF line endings
        TURN_EVENT_UNDERSCORE,
        '{"type":"turn_started","turn":2}',
        TURN_EVENT_WRAPPED,
        '{"id":"3","msg":{"type":"turn_started"}}',
    ],
)
def test_is_turn_started_event_recognises_variants(line):
    assert is_turn_started_event(line) is True


@pytest.mark.parametrize(
    "line",
    [
        "",
        "   ",
        "not json at all",
        '{"type": "turn.started"',  # truncated JSON write
        '{"type": "item.completed"}',
        '{"type": "turn.completed"}',
        '{"msg": {"type": "agent_message"}}',
        '{"msg": {"type": "turn.started"}',
        '{"msg": "turn.started"}',
        '{"type": 7}',
        '{"type": null}',
        '[{"type": "turn.started"}]',
        '"turn.started"',
    ],
)
def test_is_turn_started_event_ignores_dirty_lines(line):
    assert is_turn_started_event(line) is False


@pytest.mark.asyncio
async def test_turn_budget_exceeded_kills_process(tmp_path, monkeypatch):
    """The 3rd turn start must kill a 2-turn budget even while it runs."""
    monkeypatch.setattr(
        "app.services.codex_bridge.get_settings",
        lambda: _fake_settings(tmp_path, skip=True, timeout=300),
    )
    proc = _FakeStreamingProcess(
        [
            TURN_EVENT + "\n",
            '{"type":"item.completed","item":{"type":"agent_message"}}\n',
            "this line is not json\n",
            TURN_EVENT_WRAPPED + "\n",
            TURN_EVENT + "\n",
            TURN_EVENT + "\n",
        ],
        stdout=b"partial stdout",
        running=True,
    )
    captured: dict = {}
    _patch_streaming_subprocess(monkeypatch, proc, captured)
    killed: list[int] = []
    _patch_kill(monkeypatch, killed)

    bridge = CodexBridge(workspace_id=1, node_name="codex-test")
    result = await bridge.execute(_make_task(tmp_path, budget_turns=2))

    assert result.success is False
    assert "budget_turns=2" in result.message
    assert "3" in result.message
    assert result.metadata is not None
    assert result.metadata["budget_exceeded"] is True
    assert result.metadata["turns"] == 3
    assert result.metadata["provider"] == "codex"
    assert result.metadata["budget_turns"] == 2
    assert killed == [proc.pid]
    assert proc.killed is True
    # 流式命令仍带着 --json / -o，且使用了放大的 stream limit。
    assert "--json" in captured["cmd"]
    assert captured["kwargs"]["limit"] == STREAM_LIMIT_BYTES
    # 已捕获的 stderr 写入 events.jsonl，stdout 落盘为 output.md。
    events_text = (tmp_path / "events.jsonl").read_text(encoding="utf-8")
    assert "turn.started" in events_text
    assert "this line is not json" in events_text
    assert (tmp_path / "output.md").read_text(encoding="utf-8") == "partial stdout"
    assert result.artifacts is not None
    assert tmp_path / "events.jsonl" in result.artifacts


@pytest.mark.asyncio
async def test_turn_budget_allows_exactly_budget_turns(tmp_path, monkeypatch):
    """Exactly budget_turns turns are allowed; the run still succeeds."""
    monkeypatch.setattr(
        "app.services.codex_bridge.get_settings",
        lambda: _fake_settings(tmp_path, skip=True, timeout=300),
    )
    proc = _FakeStreamingProcess(
        [TURN_EVENT + "\n", TURN_EVENT_WRAPPED + "\n"],
        stdout=b"final answer",
    )
    captured: dict = {}
    _patch_streaming_subprocess(monkeypatch, proc, captured)
    killed: list[int] = []
    _patch_kill(monkeypatch, killed)

    bridge = CodexBridge(workspace_id=1, node_name="codex-test")
    result = await bridge.execute(_make_task(tmp_path, budget_turns=2))

    assert result.success is True
    assert result.message == "final answer"
    assert result.metadata is not None
    assert result.metadata["exit_code"] == 0
    assert killed == []
    assert proc.killed is False
    events_text = (tmp_path / "events.jsonl").read_text(encoding="utf-8")
    assert events_text.count("turn") == 2


@pytest.mark.asyncio
async def test_turn_budget_cancel_still_terminates(tmp_path, monkeypatch):
    """cancel_event keeps winning over the streaming budget path."""
    monkeypatch.setattr(
        "app.services.codex_bridge.get_settings",
        lambda: _fake_settings(tmp_path, skip=True, timeout=300),
    )
    proc = _FakeStreamingProcess(
        [TURN_EVENT + "\n"], running=True, close_stderr=False
    )
    captured: dict = {}
    _patch_streaming_subprocess(monkeypatch, proc, captured)
    killed: list[int] = []
    _patch_kill(monkeypatch, killed)

    cancel_event = asyncio.Event()
    cancel_event.set()

    bridge = CodexBridge(workspace_id=1, node_name="codex-test")
    result = await bridge.execute(
        _make_task(tmp_path, budget_turns=5, cancel_event=cancel_event)
    )

    assert result.success is False
    assert "取消" in result.message
    assert result.metadata is not None
    assert result.metadata["cancelled"] is True
    assert killed == [proc.pid]


@pytest.mark.asyncio
async def test_turn_budget_exit_code_failure_is_reported(tmp_path, monkeypatch):
    """A streaming run that exits non-zero keeps the historical failure shape."""
    monkeypatch.setattr(
        "app.services.codex_bridge.get_settings",
        lambda: _fake_settings(tmp_path, skip=True, timeout=300),
    )
    proc = _FakeStreamingProcess(
        [TURN_EVENT + "\n", '{"type":"error","message":"boom"}\n'],
        stdout=b"",
        returncode=3,
    )
    captured: dict = {}
    _patch_streaming_subprocess(monkeypatch, proc, captured)
    killed: list[int] = []
    _patch_kill(monkeypatch, killed)

    bridge = CodexBridge(workspace_id=1, node_name="codex-test")
    result = await bridge.execute(_make_task(tmp_path, budget_turns=5))

    assert result.success is False
    assert "exited with code 3" in result.message
    assert result.metadata is not None
    assert result.metadata["exit_code"] == 3
    assert result.metadata.get("budget_exceeded") is None
    assert killed == []
    assert result.artifacts is not None
    assert tmp_path / "events.jsonl" in result.artifacts
    assert "boom" in (tmp_path / "events.jsonl").read_text(encoding="utf-8")


@pytest.mark.asyncio
async def test_turn_budget_prefers_output_file_message(tmp_path, monkeypatch):
    """The -o output file still wins over stdout for the final message."""
    monkeypatch.setattr(
        "app.services.codex_bridge.get_settings",
        lambda: _fake_settings(tmp_path, skip=True, timeout=300),
    )
    (tmp_path / "output.md").write_text("written by codex", encoding="utf-8")
    proc = _FakeStreamingProcess([TURN_EVENT + "\n"], stdout=b"stdout copy")
    captured: dict = {}
    _patch_streaming_subprocess(monkeypatch, proc, captured)
    _patch_kill(monkeypatch, [])

    bridge = CodexBridge(workspace_id=1, node_name="codex-test")
    result = await bridge.execute(_make_task(tmp_path, budget_turns=1))

    assert result.success is True
    assert result.message == "written by codex"
    assert (tmp_path / "output.md").read_text(encoding="utf-8") == "written by codex"


@pytest.mark.asyncio
async def test_turn_budget_timeout_still_terminates(tmp_path, monkeypatch):
    """The configured timeout still bounds a streaming run."""
    monkeypatch.setattr(
        "app.services.codex_bridge.get_settings",
        lambda: _fake_settings(tmp_path, skip=True, timeout=1),
    )
    proc = _FakeStreamingProcess(
        [TURN_EVENT + "\n"], running=True, close_stderr=False
    )
    captured: dict = {}
    _patch_streaming_subprocess(monkeypatch, proc, captured)
    killed: list[int] = []
    _patch_kill(monkeypatch, killed)

    bridge = CodexBridge(workspace_id=1, node_name="codex-test")
    result = await bridge.execute(_make_task(tmp_path, budget_turns=5))

    assert result.success is False
    assert "timed out" in result.message
    assert "1s" in result.message
    assert killed == [proc.pid]
