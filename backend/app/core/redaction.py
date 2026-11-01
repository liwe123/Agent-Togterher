"""内容级敏感信息脱敏。

统一入口 redact_content：在消息、任务步骤、模型调用错误、集成桥接结果
落库与 WebSocket 广播前替换敏感值（API Key、Token、密码、私钥等）。
规则只替换敏感值本身，保留上下文；可通过 CONTENT_REDACTION_ENABLED=false 关闭。

设计约束：
- 纯函数、无数据库/网络依赖，便于单测；
- 规则按「最小长度 + 边界」设计，避免误伤普通文本；
- 替换文案固定为 [REDACTED:<kind>]，便于前端/审计识别。
"""

from __future__ import annotations

import logging
import re
from typing import Final

from app.core.config import get_settings

logger = logging.getLogger(__name__)

REDACTED_TEMPLATE: Final = "[REDACTED:{kind}]"

# 顺序有意义：先匹配更具体的 Key 形态，再匹配通用赋值/鉴权头。
_RULES: Final[tuple[tuple[str, re.Pattern[str]], ...]] = (
    (
        "private_key",
        re.compile(
            r"-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?"
            r"-----END [A-Z0-9 ]*PRIVATE KEY-----"
        ),
    ),
    ("anthropic_key", re.compile(r"\bsk-ant-[A-Za-z0-9_-]{20,}\b")),
    ("openai_key", re.compile(r"\bsk-[A-Za-z0-9_-]{20,}\b")),
    ("aws_access_key", re.compile(r"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b")),
    ("github_token", re.compile(r"\bgh[pousr]_[A-Za-z0-9]{20,}\b")),
    ("google_api_key", re.compile(r"\bAIza[0-9A-Za-z_-]{35}\b")),
    (
        "jwt",
        re.compile(
            r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b"
        ),
    ),
    (
        "bearer",
        re.compile(r"(?i)\bBearer\s+[A-Za-z0-9._~+/=-]{16,}"),
    ),
    (
        "assigned_secret",
        re.compile(
            r"(?i)\b(password|passwd|pwd|secret|token|api[_-]?key)\s*[:=]\s*"
            r"[\"\']?([^\s\"\',;]{6,})"
        ),
    ),
)


def _replace_assigned_secret(match: re.Match[str]) -> str:
    """保留字段名，只遮挡赋值右侧的值。"""
    field = match.group(1)
    return f"{field}=[REDACTED:assigned_secret]"


def redact_content(text: str | None) -> str | None:
    """Return text with sensitive values replaced; None/empty pass through."""
    if text is None:
        return None
    if not text:
        return text
    if not get_settings().content_redaction_enabled:
        return text

    redacted = text
    counts: dict[str, int] = {}
    for kind, pattern in _RULES:
        if kind == "assigned_secret":
            new_value, count = pattern.subn(_replace_assigned_secret, redacted)
        else:
            new_value, count = pattern.subn(
                REDACTED_TEMPLATE.format(kind=kind), redacted
            )
        if count:
            counts[kind] = count
            redacted = new_value

    if not counts:
        return text
    logger.info(
        "Content redaction applied",
        extra={"redaction_kinds": counts, "redaction_total": sum(counts.values())},
    )
    return redacted


__all__ = ["REDACTED_TEMPLATE", "redact_content"]
