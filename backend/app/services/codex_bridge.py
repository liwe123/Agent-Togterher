from __future__ import annotations

import asyncio
import json
import logging
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from app.core.config import get_settings
from app.services.bridge import BaseBridge, BridgeResult, BridgeTask

logger = logging.getLogger(__name__)

CODEX_BIN = "codex"

# Codex CLI streams JSONL events on stderr. Different CLI versions (and the
# older documented examples) spell the "a new turn begins" event either with a
# dot or an underscore, so both are accepted.
TURN_STARTED_EVENT_TYPES = frozenset({"turn.started", "turn_started"})

# asyncio's default StreamReader limit is 64 KiB per line, which is small for
# --json events carrying a file diff. A larger limit keeps one huge event from
# raising LimitOverrunError while we are streaming stderr.
STREAM_LIMIT_BYTES = 4 * 1024 * 1024


@dataclass
class _TurnCounter:
    """Mutable turn tally shared between the stderr reader and the waiter."""

    turns: int = 0
    exceeded: bool = False


def _event_type(payload: Any) -> str | None:
    """Return a JSON object's string type field, else None."""
    if not isinstance(payload, dict):
        return None
    value = payload.get("type")
    return value if isinstance(value, str) else None


def is_turn_started_event(line: str) -> bool:
    """Return True when a Codex CLI JSONL line marks the start of a turn.

    Two event shapes are accepted, because the CLI has used both:

    * flat: {"type": "turn.started"}
    * wrapped: {"id": "0", "msg": {"type": "turn.started"}}

    The underscore spelling (turn_started) is treated as the same event.
    Anything that is not a JSON object - warnings, truncated writes, blank
    lines, plain text - is reported as a non-turn line instead of raising, so
    one dirty line can never abort the stream.
    """
    try:
        payload = json.loads(line)
    except (TypeError, ValueError):
        return False
    if not isinstance(payload, dict):
        return False
    if _event_type(payload) in TURN_STARTED_EVENT_TYPES:
        return True
    return _event_type(payload.get("msg")) in TURN_STARTED_EVENT_TYPES


async def _kill_process_tree(process: asyncio.subprocess.Process) -> None:
    """Terminate a subprocess and its descendants.

    asyncio's Process.kill() only signals the direct child; on Windows the
    Codex CLI may spawn helper processes that survive. Use taskkill /T to
    reap the whole tree there, falling back to kill() on other platforms.
    """
    try:
        if sys.platform == "win32":
            subprocess.run(
                ["taskkill", "/T", "/F", "/PID", str(process.pid)],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=False,
            )
        else:
            process.kill()
    except Exception:
        try:
            process.kill()
        except Exception:
            pass
    try:
        await process.wait()
    except Exception:
        pass


async def _read_stream(stream: asyncio.StreamReader | None) -> bytes:
    """Drain a subprocess pipe, returning b"" when it is absent or closed."""
    if stream is None:
        return b""
    try:
        return await stream.read()
    except Exception:
        return b""


async def _consume_stderr(
    stream: asyncio.StreamReader | None,
    budget_turns: int,
    chunks: list[str],
    counter: _TurnCounter,
) -> None:
    """Read stderr line by line, counting turn-start events as they arrive.

    Returns early - with counter.exceeded set - as soon as the
    budget_turns + 1-th turn starts, so the caller can kill the process tree
    while that over-budget turn is still running. Every raw line is kept in
    chunks so the captured event stream can still be persisted.
    """
    if stream is None:
        return
    while True:
        try:
            raw = await stream.readline()
        except ValueError:
            # A single event exceeded the stream buffer: drop that line and
            # keep counting the remaining ones instead of failing the task.
            continue
        except (OSError, RuntimeError):
            return
        if not raw:
            return
        line = raw.decode("utf-8", errors="replace")
        chunks.append(line)
        if not is_turn_started_event(line):
            continue
        counter.turns += 1
        if counter.turns > budget_turns:
            counter.exceeded = True
            return


async def _cancel_pending(*tasks: asyncio.Future | None) -> None:
    """Cancel helper tasks and await them so nothing leaks into the loop."""
    pending = [task for task in tasks if task is not None and not task.done()]
    for task in pending:
        task.cancel()
    for task in pending:
        try:
            await task
        except asyncio.CancelledError:
            pass
        except Exception:
            logger.debug("Bridge helper task failed during cleanup", exc_info=True)


def _stream_text(task: asyncio.Future) -> str:
    """Decode a completed stream task's bytes, or return "" when unavailable."""
    if task.cancelled() or not task.done():
        return ""
    try:
        data = task.result()
    except Exception:
        return ""
    if not isinstance(data, (bytes, bytearray)):
        return ""
    return data.decode("utf-8", errors="replace").strip()


def _write_capture(
    events_file: Path,
    output_file: Path,
    stderr_text: str,
    stdout_text: str,
) -> None:
    """Persist captured streams without letting a file error mask the result.

    newline="" keeps the captured bytes verbatim: the stream reader hands back
    the child's own line endings (CRLF on some platforms), and translating
    them again would double the breaks in the JSONL trace.
    """
    try:
        events_file.write_text(stderr_text, encoding="utf-8", newline="")
    except OSError:
        logger.warning("Failed to write events file %s", events_file, exc_info=True)
    try:
        if not output_file.exists():
            output_file.write_text(stdout_text, encoding="utf-8", newline="")
    except OSError:
        logger.warning("Failed to write output file %s", output_file, exc_info=True)


async def _await_stream_outcome(
    streams: tuple[asyncio.Future, ...],
    cancel_task: asyncio.Future | None,
    timeout_seconds: float,
    counter: _TurnCounter,
) -> str:
    """Wait for the stream readers, process exit, cancel or timeout.

    Returns one of "completed", "budget", "cancelled" or "timeout"; the first
    condition that becomes true wins.
    """
    wait_set: set[asyncio.Future] = set(streams)
    if cancel_task is not None:
        wait_set.add(cancel_task)
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout_seconds
    while wait_set:
        remaining = deadline - loop.time()
        if remaining <= 0:
            return "timeout"
        done, _pending = await asyncio.wait(
            wait_set, timeout=remaining, return_when=asyncio.FIRST_COMPLETED
        )
        if not done:
            return "timeout"
        wait_set -= done
        if counter.exceeded:
            return "budget"
        if cancel_task is not None and cancel_task in done:
            return "cancelled"
    return "completed"


class CodexBridge(BaseBridge):
    """Bridge adapter that dispatches tasks to the Codex CLI (codex exec).

    Codex CLI is OpenAI's local coding agent. In non-interactive mode it
    accepts a prompt argument, streams JSONL events to stderr, and writes the
    final agent message to stdout (or a file via -o).

    This adapter:
      1. Writes the task description to a prompt file in the bridge workdir.
      2. Invokes codex exec with --json for structured event output.
      3. Captures stdout (final message) and stderr (event stream).
      4. Persists both to the workdir for traceability.
      5. Returns a BridgeResult with the final message and artifacts.

    When the task carries budget_turns, stderr is consumed incrementally
    instead of via communicate() so the turn budget can be enforced while the
    CLI is still running: the process tree is killed as soon as the
    budget_turns + 1-th turn starts.
    """

    async def execute(self, task: BridgeTask) -> BridgeResult:
        settings = get_settings()
        timeout_seconds = settings.bridge_codex_timeout_seconds
        if task.budget_seconds is not None:
            timeout_seconds = min(timeout_seconds, task.budget_seconds)

        output_file = task.output_path
        cmd = [
            CODEX_BIN,
            "exec",
            "--json",
            "--sandbox",
            "workspace-write",
        ]
        if settings.bridge_codex_skip_git_check:
            # Bridge task dirs are not git repos by default; skip the git trust
            # check. Set BRIDGE_CODEX_SKIP_GIT_CHECK=false once worktree
            # isolation (P5) makes task dirs real git repos.
            cmd.append("--skip-git-repo-check")
        cmd += ["-o", str(output_file), task.prompt_path.name]

        try:
            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=str(task.task_workdir),
                limit=STREAM_LIMIT_BYTES,
            )
        except FileNotFoundError:
            return BridgeResult(
                success=False,
                message=(
                    f"Codex CLI binary '{CODEX_BIN}' not found. "
                    "Install it with: npm install -g @openai/codex"
                ),
                metadata=self._metadata(),
            )
        except Exception as exc:
            logger.exception("CodexBridge failed to start", extra={"task_id": task.task_id})
            return BridgeResult(
                success=False,
                message=f"CodexBridge failed: {exc}",
                metadata=self._metadata(),
            )

        try:
            if task.budget_turns is not None:
                return await self._run_with_turn_budget(task, process, timeout_seconds)
            return await self._run_buffered(task, process, timeout_seconds)
        except Exception as exc:
            logger.exception("CodexBridge execution failed", extra={"task_id": task.task_id})
            return BridgeResult(
                success=False,
                message=f"CodexBridge failed: {exc}",
                metadata=self._metadata(),
            )

    async def _run_buffered(
        self,
        task: BridgeTask,
        process: asyncio.subprocess.Process,
        timeout_seconds: float,
    ) -> BridgeResult:
        """Run to completion with communicate() (no turn budget set)."""
        output_file = task.output_path
        events_file = task.events_path

        communicate_task = asyncio.ensure_future(process.communicate())
        cancel_task = self._cancel_waiter(task)
        wait_set: set[asyncio.Future] = {communicate_task}
        if cancel_task is not None:
            wait_set.add(cancel_task)

        done, _pending = await asyncio.wait(wait_set, timeout=timeout_seconds)

        cancelled_before_done = (
            cancel_task is not None
            and cancel_task in done
            and communicate_task not in done
        )
        if communicate_task not in done or cancelled_before_done:
            communicate_task.cancel()
            await _kill_process_tree(process)
            return self._interrupted_result(task, cancelled_before_done, timeout_seconds)

        stdout_bytes, stderr_bytes = communicate_task.result()

        stdout_text = stdout_bytes.decode("utf-8", errors="replace").strip()
        stderr_text = stderr_bytes.decode("utf-8", errors="replace").strip()

        events_file.write_text(stderr_text, encoding="utf-8")

        if not output_file.exists():
            output_file.write_text(stdout_text, encoding="utf-8")

        if process.returncode != 0:
            return BridgeResult(
                success=False,
                message=f"Codex CLI exited with code {process.returncode}: {stderr_text[:500]}",
                artifacts=[task.prompt_path, task.task_json_path, events_file, output_file],
                metadata=self._metadata(exit_code=process.returncode),
            )

        final_message = output_file.read_text(encoding="utf-8").strip()
        if not final_message:
            final_message = stdout_text

        return BridgeResult(
            success=True,
            message=final_message[:4000] if final_message else "Codex CLI completed (no output)",
            artifacts=[task.prompt_path, task.task_json_path, events_file, output_file],
            metadata=self._metadata(exit_code=0, events_file=str(events_file)),
        )

    async def _run_with_turn_budget(
        self,
        task: BridgeTask,
        process: asyncio.subprocess.Process,
        timeout_seconds: float,
    ) -> BridgeResult:
        """Stream stderr while enforcing task.budget_turns."""
        budget = int(task.budget_turns or 0)
        chunks: list[str] = []
        counter = _TurnCounter()
        stderr_task = asyncio.ensure_future(
            _consume_stderr(process.stderr, budget, chunks, counter)
        )
        stdout_task = asyncio.ensure_future(_read_stream(process.stdout))
        exit_task = asyncio.ensure_future(process.wait())
        cancel_task = self._cancel_waiter(task)
        try:
            outcome = await _await_stream_outcome(
                (stderr_task, stdout_task, exit_task), cancel_task, timeout_seconds, counter
            )
            if outcome == "completed":
                return self._stream_completed_result(
                    task, process, _stream_text(stdout_task), "".join(chunks)
                )
            await _kill_process_tree(process)
            await _cancel_pending(stderr_task, stdout_task, exit_task, cancel_task)
            _write_capture(
                task.events_path,
                task.output_path,
                "".join(chunks),
                _stream_text(stdout_task),
            )
            if outcome == "budget":
                return self._budget_result(task, counter)
            return self._interrupted_result(task, outcome == "cancelled", timeout_seconds)
        finally:
            await _cancel_pending(stderr_task, stdout_task, exit_task, cancel_task)

    def _stream_completed_result(
        self,
        task: BridgeTask,
        process: asyncio.subprocess.Process,
        stdout_text: str,
        stderr_text: str,
    ) -> BridgeResult:
        """Build the result for a streaming run that finished on its own."""
        events_file = task.events_path
        output_file = task.output_path
        _write_capture(events_file, output_file, stderr_text, stdout_text)
        artifacts = [task.prompt_path, task.task_json_path, events_file, output_file]

        if process.returncode != 0:
            return BridgeResult(
                success=False,
                message=f"Codex CLI exited with code {process.returncode}: {stderr_text[:500]}",
                artifacts=artifacts,
                metadata=self._metadata(exit_code=process.returncode),
            )

        final_message = self._read_output(output_file) or stdout_text
        return BridgeResult(
            success=True,
            message=final_message[:4000] if final_message else "Codex CLI completed (no output)",
            artifacts=artifacts,
            metadata=self._metadata(exit_code=0, events_file=str(events_file)),
        )

    def _budget_result(self, task: BridgeTask, counter: _TurnCounter) -> BridgeResult:
        budget = int(task.budget_turns or 0)
        return BridgeResult(
            success=False,
            message=(
                f"Codex CLI 超出轮次预算：budget_turns={budget}，"
                f"实际开始 {counter.turns} 轮（第 {budget + 1} 轮开始即终止）"
            ),
            artifacts=[task.prompt_path, task.task_json_path, task.events_path, task.output_path],
            metadata=self._metadata(
                budget_exceeded=True,
                turns=counter.turns,
                budget_turns=budget,
                events_file=str(task.events_path),
            ),
        )

    def _interrupted_result(
        self,
        task: BridgeTask,
        cancelled: bool,
        timeout_seconds: float,
    ) -> BridgeResult:
        if cancelled:
            return BridgeResult(
                success=False,
                message=f"任务 {task.task_id} 已被用户取消",
                metadata=self._metadata(cancelled=True),
            )
        return BridgeResult(
            success=False,
            message=f"Codex CLI timed out after {timeout_seconds}s for task {task.task_id}",
            metadata=self._metadata(),
        )

    def _metadata(self, **extra: Any) -> dict[str, Any]:
        metadata: dict[str, Any] = {
            "node": self.node_name,
            "mode": "cli",
            "provider": "codex",
        }
        metadata.update(extra)
        return metadata

    @staticmethod
    def _cancel_waiter(task: BridgeTask) -> asyncio.Future | None:
        if task.cancel_event is None:
            return None
        return asyncio.ensure_future(task.cancel_event.wait())

    @staticmethod
    def _read_output(output_file: Path) -> str:
        try:
            return output_file.read_text(encoding="utf-8", errors="replace").strip()
        except OSError:
            return ""
