from __future__ import annotations

import asyncio
from pathlib import Path

from app.services.bridge import BaseBridge, BridgeResult, BridgeTask


class CursorBridge(BaseBridge):
    async def execute(self, task: BridgeTask) -> BridgeResult:
        instructions = task.task_workdir / "INSTRUCTIONS.md"
        instructions.write_text(
            "# Cursor Bridge Task\n\n"
            f"任务标题：{task.task_title}\n\n"
            f"任务描述：\n{task.task_description}\n",
            encoding="utf-8",
        )
        readme = task.task_workdir / "README.txt"
        readme.write_text(
            "Cursor Bridge 已准备任务目录。\n"
            "这里可以放置要交给 Cursor 的上下文、补丁和结果。\n",
            encoding="utf-8",
        )
        await asyncio.sleep(0)
        return BridgeResult(
            success=True,
            message=f"Cursor Bridge 已准备任务 {task.task_id} 的工作目录",
            artifacts=[instructions, readme],
            metadata={"node": self.node_name, "mode": "bridge"},
        )
