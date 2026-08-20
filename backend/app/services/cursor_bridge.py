from __future__ import annotations

import asyncio
import json
import logging
from pathlib import Path

from app.core.config import get_settings
from app.services.bridge import BaseBridge, BridgeResult, BridgeTask

logger = logging.getLogger(__name__)

# How often to check output.md while waiting for the Cursor client to write back.
POLL_INTERVAL_SECONDS = 2.0
# Cap the content returned to the task timeline to avoid oversized payloads.
MAX_OUTPUT_LENGTH = 4000


class CursorBridge(BaseBridge):
    async def execute(self, task: BridgeTask) -> BridgeResult:
        """Wait for the real Cursor client to write ``output.md``.

        The workdir (PROMPT.md / task.json / output.md / events.jsonl) is
        prepared by ``dispatch_task_to_node`` before this method runs. We poll
        ``output.md`` until it contains non-empty content or the configured
        timeout (``BRIDGE_OUTPUT_POLL_TIMEOUT_SECONDS``, default 600s) elapses.
        """
        timeout = get_settings().bridge_output_poll_timeout_seconds
        waited = 0.0
        while waited < timeout:
            try:
                content = task.output_path.read_text(
                    encoding="utf-8", errors="replace"
                ).strip()
            except FileNotFoundError:
                content = ""
            if content:
                self._append_event(task.events_path, "output_received", {"length": len(content)})
                return BridgeResult(
                    success=True,
                    message=content[:MAX_OUTPUT_LENGTH],
                    artifacts=[task.output_path, task.prompt_path, task.task_json_path],
                    metadata={"node": self.node_name, "mode": "bridge"},
                )
            await asyncio.sleep(POLL_INTERVAL_SECONDS)
            waited += POLL_INTERVAL_SECONDS

        self._append_event(task.events_path, "timeout", {"timeout_seconds": timeout})
        return BridgeResult(
            success=False,
            message="Cursor 未在超时内写回 output.md",
            artifacts=[task.output_path],
            metadata={"node": self.node_name, "mode": "bridge"},
        )

    @staticmethod
    def _append_event(events_path: Path, event: str, detail: dict | None = None) -> None:
        try:
            from app.db.base import utc_now

            record = {
                "event": event,
                "at": utc_now().isoformat(),
                "detail": detail or {},
            }
            with events_path.open("a", encoding="utf-8") as fh:
                fh.write(json.dumps(record, ensure_ascii=False) + "\n")
        except Exception:
            logger.debug("Failed to append event log for %s", events_path)
