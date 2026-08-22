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
    acceptance_criteria: tuple[str, ...] | None = None
    allowed_paths: tuple[str, ...] | None = None
    test_command: str | None = None
    budget_seconds: int | None = None
    budget_turns: int | None = None
    dependencies: tuple[str, ...] | None = None
    # asyncio.Event set by POST /tasks/{id}/cancel; bridges poll it to abort.
    cancel_event: Any = None


def _render_prompt(
    title: str,
    description: str,
    acceptance_criteria: tuple[str, ...] | None,
    allowed_paths: tuple[str, ...] | None,
    test_command: str | None,
) -> str:
    sections = [f"# {title}", "", description.strip()]
    if acceptance_criteria:
        sections.append("")
        sections.append("## 验收条件")
        sections.extend(f"- [ ] {item}" for item in acceptance_criteria)
    if allowed_paths:
        sections.append("")
        sections.append("## 路径约束")
        sections.append("只允许读写以下路径，禁止触碰其他文件：")
        sections.extend(f"- {path}" for path in allowed_paths)
    if test_command:
        sections.append("")
        sections.append("## 验证命令")
        sections.append(f"`{test_command}` 必须通过后才算完成。")
        sections.append("若无验证命令，请逐条回应「验收条件」并说明满足依据。")
    return "\n".join(sections).rstrip() + "\n"


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

    def prepare_task(
        self,
        task_id: int,
        title: str,
        description: str,
        *,
        acceptance_criteria: list[str] | None = None,
        allowed_paths: list[str] | None = None,
        test_command: str | None = None,
        budget_seconds: int | None = None,
        budget_turns: int | None = None,
        dependencies: list[str] | None = None,
        cancel_event: Any = None,
    ) -> BridgeTask:
        task_dir = self.bridge_root / f"task-{task_id}"
        task_dir.mkdir(parents=True, exist_ok=True)

        task_json_path = task_dir / "task.json"
        prompt_path = task_dir / "PROMPT.md"
        output_path = task_dir / "output.md"
        events_path = task_dir / "events.jsonl"

        criteria_tuple = tuple(acceptance_criteria) if acceptance_criteria else None
        paths_tuple = tuple(allowed_paths) if allowed_paths else None
        deps_tuple = tuple(dependencies) if dependencies else None

        task_json: dict[str, Any] = {
            "task_id": task_id,
            "title": title,
            "description": description,
            "workspace_id": self.workspace_id,
            "node_name": self.node_name,
        }
        if criteria_tuple is not None:
            task_json["acceptance_criteria"] = list(criteria_tuple)
        if paths_tuple is not None:
            task_json["allowed_paths"] = list(paths_tuple)
        if test_command is not None:
            task_json["test_command"] = test_command
        if budget_seconds is not None:
            task_json["budget_seconds"] = budget_seconds
        if budget_turns is not None:
            task_json["budget_turns"] = budget_turns
        if deps_tuple is not None:
            task_json["dependencies"] = list(deps_tuple)
        task_json_path.write_text(
            json.dumps(task_json, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        prompt_path.write_text(
            _render_prompt(title, description, criteria_tuple, paths_tuple, test_command),
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
            acceptance_criteria=criteria_tuple,
            allowed_paths=paths_tuple,
            test_command=test_command,
            budget_seconds=budget_seconds,
            budget_turns=budget_turns,
            dependencies=deps_tuple,
            cancel_event=cancel_event,
        )

    @abstractmethod
    async def execute(self, task: BridgeTask) -> BridgeResult:
        raise NotImplementedError
