from __future__ import annotations

import json
from collections.abc import Sequence

from app.agents.manager_agent import ManagerPlan
from app.models import Agent
from app.services import litellm_service
from app.services.litellm_service import ChatCompletionResult


async def build_final_result(
    manager: Agent,
    original_task: str,
    plan: ManagerPlan,
    worker_results: Sequence[dict[str, object]],
    review_result: str,
    api_keys: dict[str, str] | None = None,
    custom_models: dict[str, dict] | None = None,
    context_messages: list[dict] | None = None,
) -> ChatCompletionResult:
    user_prompt = (
        "请作为项目总设计师汇总 Worker 执行结果和测试专员审核。"
        "最终答复必须直接回应用户任务，吸收审核中的有效修改建议，区分已完成内容、"
        "风险/限制和建议的下一步；不要声称未实际完成的工作已经完成。\n\n"
        f"原始任务：\n{original_task}\n\n"
        f"任务计划：\n{json.dumps(plan.model_dump(), ensure_ascii=False)}\n\n"
        f"Worker 结果：\n{json.dumps(list(worker_results), ensure_ascii=False)}\n\n"
        f"测试专员审核：\n{review_result}"
    )
    return await litellm_service.chat_completion(
        manager.model_name,
        [
            {"role": "system", "content": manager.system_prompt},
            *(context_messages or []),
            {"role": "user", "content": user_prompt},
        ],
        temperature=0.3,
        api_keys=api_keys,
        custom_models=custom_models,
    )


__all__ = ["build_final_result"]
