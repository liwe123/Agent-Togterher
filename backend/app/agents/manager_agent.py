from __future__ import annotations

import json
from collections.abc import Sequence
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

from app.models import Agent
from app.services import litellm_service
from app.services.litellm_service import ChatCompletionResult

TaskType = Literal["frontend", "backend", "knowledge", "deployment"]

WORKER_BY_TASK_TYPE: dict[str, str] = {
    "frontend": "前端设计师",
    "backend": "Agent工程师",
    "knowledge": "知识库管理员",
    "deployment": "运维",
}


class ManagerPlanError(ValueError):
    """Raised when the manager does not return a valid workflow plan."""


class ManagerSubtask(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    id: int = Field(ge=1, le=3)
    title: str = Field(min_length=1, max_length=255)
    description: str = Field(min_length=1, max_length=4000)
    task_type: TaskType
    agent: str = Field(min_length=1, max_length=100)

    @model_validator(mode="after")
    def validate_worker_mapping(self) -> "ManagerSubtask":
        expected_agent = WORKER_BY_TASK_TYPE[self.task_type]
        if self.agent != expected_agent:
            raise ValueError(
                f"task_type '{self.task_type}' must use agent '{expected_agent}'"
            )
        return self


class ManagerPlan(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    task_summary: str = Field(min_length=1, max_length=2000)
    subtasks: list[ManagerSubtask] = Field(min_length=1, max_length=3)

    @model_validator(mode="after")
    def validate_subtask_ids(self) -> "ManagerPlan":
        ids = [subtask.id for subtask in self.subtasks]
        if len(ids) != len(set(ids)):
            raise ValueError("subtask ids must be unique")
        if ids != list(range(1, len(ids) + 1)):
            raise ValueError("subtask ids must be consecutive and start at 1")
        return self


def parse_manager_plan(content: str) -> ManagerPlan:
    """Parse a manager response while tolerating an outer Markdown code fence."""
    raw = content.strip()
    if raw.startswith("```"):
        lines = raw.splitlines()
        if lines and lines[0].strip().lower() in {"```", "```json"}:
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        raw = "\n".join(lines).strip()

    try:
        payload = json.loads(raw)
        return ManagerPlan.model_validate(payload)
    except (json.JSONDecodeError, ValidationError, TypeError) as exc:
        raise ManagerPlanError(f"Manager returned an invalid JSON plan: {exc}") from exc


def serialize_manager_plan(plan: ManagerPlan) -> str:
    return json.dumps(plan.model_dump(), ensure_ascii=False, indent=2)


async def generate_plan(
    manager: Agent,
    task_description: str,
    available_agent_names: Sequence[str],
    api_keys: dict[str, str] | None = None,
    custom_models: dict[str, dict] | None = None,
) -> ChatCompletionResult:
    """Ask the project architect to return a strict 1-3 subtask JSON plan."""
    available = ", ".join(sorted(set(available_agent_names)))
    schema_example = {
        "task_summary": "对用户目标和交付物的简要理解",
        "subtasks": [
            {
                "id": 1,
                "title": "子任务标题",
                "description": "可独立执行且可验收的工作说明",
                "task_type": "backend",
                "agent": "Agent工程师",
            }
        ],
    }
    user_prompt = (
        "请理解下面的复杂任务，将其拆分为 1 到 3 个可顺序执行的子任务。\n"
        "只能使用以下任务类型和 Agent 固定映射：\n"
        "- frontend -> 前端设计师\n"
        "- backend（含 API、后端、Agent 逻辑）-> Agent工程师\n"
        "- knowledge（含知识库、RAG）-> 知识库管理员\n"
        "- deployment（含部署、环境变量、Docker）-> 运维\n"
        f"当前工作区可用 Agent：{available}\n"
        "只输出一个 JSON 对象，不要输出 Markdown、解释或额外字段。"
        "subtasks 必须为 1 到 3 项，id 必须从 1 连续递增。\n"
        f"JSON 结构示例：{json.dumps(schema_example, ensure_ascii=False)}\n\n"
        f"用户任务：\n{task_description}"
    )
    return await litellm_service.chat_completion(
        manager.model_name,
        [
            {"role": "system", "content": manager.system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        temperature=0.2,
        api_keys=api_keys,
        custom_models=custom_models,
    )


__all__ = [
    "ManagerPlan",
    "ManagerPlanError",
    "ManagerSubtask",
    "TaskType",
    "WORKER_BY_TASK_TYPE",
    "generate_plan",
    "parse_manager_plan",
    "serialize_manager_plan",
]
