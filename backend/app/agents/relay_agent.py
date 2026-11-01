"""群聊多 Agent 接力中的单个 Agent 回合。

参考 DS-Bot 群聊的发言循环：每一棒都能看到「本轮发言顺序、自己的位置、
上一棒以来的全部内容」，然后交付自己这一棒的产出；没有新增内容时以
[PASS] 静默让位。本模块只负责构造提示词并调用模型，状态持久化与事件
广播由 AgentOrchestrator 负责。
"""

from __future__ import annotations

from collections.abc import Sequence

from app.models import Agent
from app.services import litellm_service
from app.services.litellm_service import ChatCompletionResult

PASS_MARKER = "[PASS]"


def build_relay_order(chain: Sequence[Agent]) -> str:
    """Render the speaking order (1-based) for the relay prompt."""
    return " → ".join(
        f"{index}. {agent.name}" for index, agent in enumerate(chain, start=1)
    )


def build_relay_prompt(
    original_task: str,
    chain: Sequence[Agent],
    position: int,
    previous_outputs: Sequence[tuple[str, str]],
) -> str:
    """Build the user prompt for one relay hop (position is 1-based)."""
    current = chain[position - 1]
    if previous_outputs:
        history = "\n\n".join(
            f"【第 {index} 棒 · {name}】\n{content}"
            for index, (name, content) in enumerate(previous_outputs, start=1)
        )
    else:
        history = "（你是第一棒，尚无前序产出）"
    return (
        "你正在参与一次多 Agent 群聊接力，成员按用户指定顺序依次接棒，"
        "同一时间只有一棒发言。请基于前序产出完成你这一棒要交付的内容。\n\n"
        f"原始任务：\n{original_task}\n\n"
        f"接力顺序：{build_relay_order(chain)}\n"
        f"你是第 {position} 棒（共 {len(chain)} 棒）：{current.name}，"
        f"职责：{current.role}。\n\n"
        f"前序产出：\n{history}\n\n"
        "输出要求：\n"
        "1. 直接给出你这一棒要发到群聊里的可交付内容，不要复述或重写前序产出；\n"
        "2. 如果任务需要落地执行（写代码、改文档、做检查），现在就完成并说明结果；\n"
        "3. 接力顺序已由用户固定，不要在回复里 @ 其他成员；\n"
        "4. 若你这一棒确实没有新增内容可补充，只回复一个标记："
        f"{PASS_MARKER}\n"
    )


async def execute_turn(
    agent: Agent,
    original_task: str,
    chain: Sequence[Agent],
    position: int,
    previous_outputs: Sequence[tuple[str, str]],
    api_keys: dict[str, str] | None = None,
    custom_models: dict[str, dict] | None = None,
    tools: list[dict] | None = None,
    extra_messages: list[dict] | None = None,
    context_messages: list[dict] | None = None,
) -> ChatCompletionResult:
    """Call the hop agent's model with the relay prompt."""
    user_prompt = build_relay_prompt(original_task, chain, position, previous_outputs)
    return await litellm_service.chat_completion(
        agent.model_name,
        [
            {"role": "system", "content": agent.system_prompt},
            *(context_messages or []),
            {"role": "user", "content": user_prompt},
            *(extra_messages or []),
        ],
        temperature=0.4,
        tools=tools,
        api_keys=api_keys,
        custom_models=custom_models,
    )


__all__ = [
    "PASS_MARKER",
    "build_relay_order",
    "build_relay_prompt",
    "execute_turn",
]
