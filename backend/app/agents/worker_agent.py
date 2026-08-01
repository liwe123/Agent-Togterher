from __future__ import annotations

import json

from app.agents.manager_agent import ManagerPlan, ManagerSubtask, WORKER_BY_TASK_TYPE
from app.models import Agent
from app.services import litellm_service
from app.services.litellm_service import ChatCompletionResult

WORKER_ROLE_BY_TASK_TYPE = {
    "frontend": "frontend_designer",
    "backend": "agent_engineer",
    "knowledge": "knowledge_manager",
    "deployment": "operations_engineer",
}


def worker_name_for_task_type(task_type: str) -> str:
    try:
        return WORKER_BY_TASK_TYPE[task_type]
    except KeyError as exc:
        raise ValueError(f"Unsupported worker task type: {task_type}") from exc


async def execute_subtask(
    worker: Agent,
    original_task: str,
    plan: ManagerPlan,
    subtask: ManagerSubtask,
    api_keys: dict[str, str] | None = None,
) -> ChatCompletionResult:
    expected_worker = worker_name_for_task_type(subtask.task_type)
    expected_role = WORKER_ROLE_BY_TASK_TYPE[subtask.task_type]
    if worker.name != expected_worker and worker.role != expected_role:
        raise ValueError(
            f"Subtask type '{subtask.task_type}' requires '{expected_worker}', "
            f"not '{worker.name}'"
        )

    user_prompt = (
        "你正在执行项目总设计师分派的一个子任务。请给出可直接交付、可验证的执行结果，"
        "明确完成内容、关键产物以及仍存在的限制。不要改写任务计划。\n\n"
        f"原始任务：\n{original_task}\n\n"
        f"总体计划：\n{json.dumps(plan.model_dump(), ensure_ascii=False)}\n\n"
        f"当前子任务：\n{json.dumps(subtask.model_dump(), ensure_ascii=False)}"
    )
    return await litellm_service.chat_completion(
        worker.model_name,
        [
            {"role": "system", "content": worker.system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        temperature=0.4,
        api_keys=api_keys,
    )


__all__ = [
    "WORKER_ROLE_BY_TASK_TYPE",
    "execute_subtask",
    "worker_name_for_task_type",
]
