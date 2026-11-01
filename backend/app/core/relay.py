"""群聊多 Agent 接力（relay handoff）的共享工具。

参考 DS-Bot 的群聊顺序发言模型：一条用户消息可以按 @ 出现顺序编排多个
Agent 依次接力，前一棒的产出作为后一棒的上下文。本模块只承载纯函数，
不依赖数据库与编排器，便于单测与复用：

- MAX_RELAY_AGENTS：单条消息可编排的接力棒数上限。
- parse_relay_agent_ids / dump_relay_agent_ids：tasks.relay_agent_ids_json
  的安全序列化与解析（脏数据按空链处理，避免阻断任务执行）。
- is_pass_reply：判定某一棒是否「无新增内容」（对齐 DS-Bot 的 [PASS]）。
"""

from __future__ import annotations

import json
import re
from typing import Final

# 接力链长度上限：避免单条消息触发过长 Token 消耗与等待。
MAX_RELAY_AGENTS: Final = 6

# DS-Bot groups.js:81 的等价判定：整条回复只是 PASS 标记（含中英文括号变体），
# 或为空。只做「整条匹配」，绝不做包含匹配，避免误伤正常输出。
_PASS_PATTERN = re.compile(
    r"^\s*"
    r"(?:[\[【(（]\s*pass\s*[\]】)）]"
    r"|pass\s*[.。!！]?)"
    r"\s*$",
    re.IGNORECASE,
)


def parse_relay_agent_ids(raw: str | None) -> list[int]:
    """Parse relay_agent_ids_json into an ordered list of agent ids.

    Only a JSON array whose elements are all positive integers is accepted.
    Any malformed value degrades to an empty chain so a dirty row can never
    block task execution (same all-or-nothing rule as workflow snapshots).
    """
    if not raw or not raw.strip():
        return []
    try:
        value = json.loads(raw)
    except (TypeError, ValueError):
        return []
    if not isinstance(value, list):
        return []
    ids: list[int] = []
    for item in value:
        if isinstance(item, bool) or not isinstance(item, int) or item <= 0:
            return []
        if item not in ids:
            ids.append(item)
    return ids[:MAX_RELAY_AGENTS]


def dump_relay_agent_ids(agent_ids: list[int]) -> str | None:
    """Serialize an ordered relay chain; fewer than 2 hops means no relay."""
    chain: list[int] = []
    for agent_id in agent_ids:
        if (
            isinstance(agent_id, bool)
            or not isinstance(agent_id, int)
            or agent_id <= 0
        ):
            continue
        if agent_id not in chain:
            chain.append(agent_id)
    chain = chain[:MAX_RELAY_AGENTS]
    if len(chain) < 2:
        return None
    return json.dumps(chain, ensure_ascii=False, separators=(",", ":"))


def is_pass_reply(content: str | None) -> bool:
    """Return True when a relay hop explicitly passes (or returns nothing)."""
    if content is None:
        return True
    text = content.strip()
    if not text:
        return True
    return _PASS_PATTERN.match(text) is not None


__all__ = [
    "MAX_RELAY_AGENTS",
    "dump_relay_agent_ids",
    "is_pass_reply",
    "parse_relay_agent_ids",
]
