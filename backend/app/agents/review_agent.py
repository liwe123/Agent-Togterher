from __future__ import annotations

import json
from collections.abc import Sequence

from app.agents.manager_agent import ManagerPlan
from app.models import Agent
from app.services import litellm_service
from app.services.litellm_service import ChatCompletionResult


async def review_results(
    reviewer: Agent,
    original_task: str,
    plan: ManagerPlan,
    worker_results: Sequence[dict[str, object]],
    api_keys: dict[str, str] | None = None,
    custom_models: dict[str, dict] | None = None,
) -> ChatCompletionResult:
    user_prompt = (
        "请作为测试专员审核本次多 Agent 执行结果。逐项检查是否满足原始需求和计划，"
        "指出缺失、漏洞、风险或不可验证的声明，并给出具体修改建议。"
        "输出应包含：结论、通过项、问题清单、修改建议。\n\n"
        f"原始任务：\n{original_task}\n\n"
        f"任务计划：\n{json.dumps(plan.model_dump(), ensure_ascii=False)}\n\n"
        f"Worker 结果：\n{json.dumps(list(worker_results), ensure_ascii=False)}"
    )
    return await litellm_service.chat_completion(
        reviewer.model_name,
        [
            {"role": "system", "content": reviewer.system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        temperature=0.2,
        api_keys=api_keys,
        custom_models=custom_models,
    )


__all__ = ["review_results"]
