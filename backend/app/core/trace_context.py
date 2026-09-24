"""Trace / correlation identifier helpers (R-05).

Two identifiers, per ``docs/架构治理基线.md`` §4:

- ``correlation_id``：一次用户意图 / 会话级标识，从原始 Message 沿 Task、
  事件、后台动作与日志传播。
- ``trace_id``：一次任务执行链标识，从 Task 沿 TaskStep、ModelCall、工具调用、
  Worker 日志与事件传播。

格式统一为小写 UUID 十六进制串（32 字符），数据库列按 36 位文本容量存储。
"""
from __future__ import annotations

import uuid
from typing import Any

TRACE_ID_LENGTH = 36


def new_trace_id() -> str:
    """Generate a fresh task-execution trace id."""
    return uuid.uuid4().hex


def new_correlation_id() -> str:
    """Generate a fresh user-intent correlation id."""
    return uuid.uuid4().hex


def stamp_new_message(message: Any, *, correlation_id: str | None = None) -> Any:
    """Attach correlation semantics to a brand-new user message."""
    message.correlation_id = correlation_id or new_correlation_id()
    message.trace_id = None
    return message


def stamp_task(task: Any, *, source_message: Any | None = None) -> Any:
    """Attach identifiers to a task, inheriting correlation from its input message."""
    inherited_correlation = getattr(source_message, "correlation_id", None)
    task.correlation_id = inherited_correlation or new_correlation_id()
    task.trace_id = getattr(source_message, "trace_id", None) or new_trace_id()
    return task


def inherit_from_task(target: Any, task: Any) -> Any:
    """Propagate a task's trace / correlation ids onto a child record."""
    target.trace_id = getattr(task, "trace_id", None) or new_trace_id()
    target.correlation_id = getattr(task, "correlation_id", None)
    return target


__all__ = [
    "TRACE_ID_LENGTH",
    "inherit_from_task",
    "new_correlation_id",
    "new_trace_id",
    "stamp_new_message",
    "stamp_task",
]
