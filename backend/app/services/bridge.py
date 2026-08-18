from __future__ import annotations

import json
from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from app.core.config import get_settings


@dataclass(frozen=True)
class BridgeTask:
    task_id: int
    task_title: str
    task_description: str
    workspace_id: int
    task_workdir: Path
    prompt_path: Path
    task_json_path: Path
    output_path: Path
    events_path: Path


@dataclass(frozen=True)
class BridgeResult:
    success: bool
    message: str
    artifacts: list[Path] | None = None
    metadata: dict[str, Any] | None = None


class BaseBridge(ABC):
    def __init__(self, workspace_id: int, node_name: str) -> None:
        self.workspace_id = workspace_id
        self.node_name = node_name
        root = Path(get_settings().bridge_root_dir).expanduser()
        self.bridge_root = root / f"workspace-{workspace_id}" / node_name
        self.bridge_root.mkdir(parents=True, exist_ok=True)

    def prepare_task(self, task_id: int, title: str, description: str) -> BridgeTask:
        task_dir = self.bridge_root / f"task-{task_id}"
        task_dir.mkdir(parents=True, exist_ok=True)

        task_json_path = task_dir / "task.json"
        prompt_path = task_dir / "PROMPT.md"
        output_path = task_dir / "output.md"
        events_path = task_dir / "events.jsonl"

        task_json_path.write_text(
            json.dumps(
                {
                    "task_id": task_id,
                    "title": title,
                    "description": description,
                    "workspace_id": self.workspace_id,
                    "node_name": self.node_name,
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
        prompt_path.write_text(
            f"# {title}\n\n{description}\n",
            encoding="utf-8",
        )
        output_path.write_text("", encoding="utf-8")
        events_path.write_text("", encoding="utf-8")

        return BridgeTask(
            task_id=task_id,
            task_title=title,
            task_description=description,
            workspace_id=self.workspace_id,
            task_workdir=task_dir,
            prompt_path=prompt_path,
            task_json_path=task_json_path,
            output_path=output_path,
            events_path=events_path,
        )

    @abstractmethod
    async def execute(self, task: BridgeTask) -> BridgeResult:
        raise NotImplementedError
