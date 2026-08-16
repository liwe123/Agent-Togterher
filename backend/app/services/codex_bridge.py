from __future__ import annotations

import asyncio
import logging
from pathlib import Path

from app.services.bridge import BaseBridge, BridgeResult, BridgeTask

logger = logging.getLogger(__name__)

CODEX_BIN = "codex"
DEFAULT_TIMEOUT = 300


class CodexBridge(BaseBridge):
    """Bridge adapter that dispatches tasks to the Codex CLI (`codex exec`).

    Codex CLI is OpenAI's local coding agent.  In non-interactive mode it
    accepts a prompt argument, streams JSONL events to stderr, and writes the
    final agent message to stdout (or a file via ``-o``).

    This adapter:
      1. Writes the task description to a prompt file in the bridge workdir.
      2. Invokes ``codex exec`` with ``--json`` for structured event output.
      3. Captures stdout (final message) and stderr (event stream).
      4. Persists both to the workdir for traceability.
      5. Returns a :class:`BridgeResult` with the final message and artifacts.
    """

    async def execute(self, task: BridgeTask) -> BridgeResult:
        prompt_file = task.task_workdir / "PROMPT.md"
        prompt_file.write_text(
            f"# {task.task_title}\n\n{task.task_description}\n",
            encoding="utf-8",
        )

        output_file = task.task_workdir / "output.md"
        events_file = task.task_workdir / "events.jsonl"

        cmd = [
            CODEX_BIN,
            "exec",
            "--json",
            "--sandbox",
            "workspace-write",
            "--skip-git-repo-check",
            "-o",
            str(output_file),
            task.task_description,
        ]

        try:
            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=str(task.task_workdir),
            )

            try:
                stdout_bytes, stderr_bytes = await asyncio.wait_for(
                    process.communicate(), timeout=DEFAULT_TIMEOUT
                )
            except asyncio.TimeoutError:
                process.kill()
                await process.wait()
                return BridgeResult(
                    success=False,
                    message=f"Codex CLI timed out after {DEFAULT_TIMEOUT}s for task {task.task_id}",
                    metadata={"node": self.node_name, "mode": "cli", "provider": "codex"},
                )

            stdout_text = stdout_bytes.decode("utf-8", errors="replace").strip()
            stderr_text = stderr_bytes.decode("utf-8", errors="replace").strip()

            events_file.write_text(stderr_text, encoding="utf-8")

            if not output_file.exists():
                output_file.write_text(stdout_text, encoding="utf-8")

            if process.returncode != 0:
                return BridgeResult(
                    success=False,
                    message=f"Codex CLI exited with code {process.returncode}: {stderr_text[:500]}",
                    artifacts=[prompt_file, events_file, output_file],
                    metadata={
                        "node": self.node_name,
                        "mode": "cli",
                        "provider": "codex",
                        "exit_code": process.returncode,
                    },
                )

            final_message = output_file.read_text(encoding="utf-8").strip()
            if not final_message:
                final_message = stdout_text

            return BridgeResult(
                success=True,
                message=final_message[:4000] if final_message else "Codex CLI completed (no output)",
                artifacts=[prompt_file, events_file, output_file],
                metadata={
                    "node": self.node_name,
                    "mode": "cli",
                    "provider": "codex",
                    "exit_code": 0,
                    "events_file": str(events_file),
                },
            )

        except FileNotFoundError:
            return BridgeResult(
                success=False,
                message=(
                    f"Codex CLI binary '{CODEX_BIN}' not found. "
                    "Install it with: npm install -g @openai/codex"
                ),
                metadata={"node": self.node_name, "mode": "cli", "provider": "codex"},
            )
        except Exception as exc:
            logger.exception("CodexBridge execution failed", extra={"task_id": task.task_id})
            return BridgeResult(
                success=False,
                message=f"CodexBridge failed: {exc}",
                metadata={"node": self.node_name, "mode": "cli", "provider": "codex"},
            )
