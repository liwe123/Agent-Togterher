from __future__ import annotations

import json
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from app.models import Agent, ModelCall, Task, TaskStep

MAX_CONTEXT_ITEMS = 8
MAX_CONTEXT_TEXT = 900
MAX_SUMMARY_TEXT = 1800

_STAGE_LABELS: dict[str, str] = {
    "single_agent": "单 Agent 执行",
    "manager_plan": "Manager 规划",
    "worker_execute": "Worker 执行",
    "review_results": "QA 审核",
    "final_summary": "Final 汇总",
    "tool_loop": "工具调用回合",
}


@dataclass(slots=True)
class TraceArtifact:
    """Normalized trace data for both model context and UI rendering."""

    trace_summary: str
    execution_trace: list[dict[str, Any]]
    context_payload: dict[str, Any]


def build_trace_artifact(
    task: Task,
    *,
    current_stage: str,
    agent: Agent | None = None,
    completed_steps: Sequence[TaskStep] | None = None,
    model_calls: Sequence[ModelCall] | None = None,
    stage_payload: dict[str, Any] | None = None,
    failure_notes: str | None = None,
) -> TraceArtifact:
    steps = list(completed_steps or [])
    calls = list(model_calls or [])
    stage_summary = _stage_summary(current_stage)
    payload = {
        "task_summary": {
            "id": task.id,
            "title": task.title,
            "description": _trim(task.description, MAX_SUMMARY_TEXT),
            "priority": task.priority,
            "status": task.status.value if hasattr(task.status, "value") else str(task.status),
            "assigned_agent": _agent_snapshot(agent or getattr(task, "assigned_agent", None)),
        },
        "current_stage": current_stage,
        "current_stage_label": stage_summary,
        "completed_steps": [_step_snapshot(step) for step in steps[-MAX_CONTEXT_ITEMS:]],
        "recent_tool_results": _recent_tool_results(steps),
        "recent_model_calls": [_model_call_snapshot(call) for call in calls[-MAX_CONTEXT_ITEMS:]],
        "open_issues": _open_issues(steps, calls, failure_notes),
        "constraints": [
            "保持结构化执行轨迹，优先复用已有结果，避免重复探索。",
            "必要时先摘要再继续，不要把完整历史无限注入上下文。",
        ],
    }
    if stage_payload:
        payload["stage_payload"] = stage_payload
    if failure_notes:
        payload["failure_notes"] = _trim(failure_notes, MAX_SUMMARY_TEXT)

    execution_trace = _execution_trace(steps, calls, current_stage)
    trace_summary = _build_trace_summary(task, current_stage, steps, calls, failure_notes)
    return TraceArtifact(
        trace_summary=trace_summary,
        execution_trace=execution_trace,
        context_payload=payload,
    )


def build_context_message(
    task: Task,
    *,
    current_stage: str,
    agent: Agent | None = None,
    completed_steps: Sequence[TaskStep] | None = None,
    model_calls: Sequence[ModelCall] | None = None,
    stage_payload: dict[str, Any] | None = None,
    failure_notes: str | None = None,
) -> dict[str, str]:
    artifact = build_trace_artifact(
        task,
        current_stage=current_stage,
        agent=agent,
        completed_steps=completed_steps,
        model_calls=model_calls,
        stage_payload=stage_payload,
        failure_notes=failure_notes,
    )
    return {
        "role": "system",
        "content": (
            "任务级上下文（结构化执行轨迹，供继续执行时使用）:\n"
            f"```json\n{json.dumps(artifact.context_payload, ensure_ascii=False, indent=2)}\n```"
        ),
    }


def build_trace_summary(
    task: Task,
    *,
    current_stage: str,
    completed_steps: Sequence[TaskStep] | None = None,
    model_calls: Sequence[ModelCall] | None = None,
    failure_notes: str | None = None,
) -> str:
    artifact = build_trace_artifact(
        task,
        current_stage=current_stage,
        completed_steps=completed_steps,
        model_calls=model_calls,
        failure_notes=failure_notes,
    )
    return artifact.trace_summary


def build_execution_trace(
    task: Task,
    *,
    current_stage: str,
    completed_steps: Sequence[TaskStep] | None = None,
    model_calls: Sequence[ModelCall] | None = None,
    failure_notes: str | None = None,
) -> list[dict[str, Any]]:
    artifact = build_trace_artifact(
        task,
        current_stage=current_stage,
        completed_steps=completed_steps,
        model_calls=model_calls,
        failure_notes=failure_notes,
    )
    return artifact.execution_trace


def _execution_trace(
    steps: Sequence[TaskStep],
    calls: Sequence[ModelCall],
    current_stage: str,
) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    step_by_id = {step.id: step for step in steps}
    call_by_id = {call.id: call for call in calls}

    for step in steps:
        events.append(
            {
                "type": _event_type_for_step(step),
                "stage": current_stage,
                "title": step.step_name,
                "actor": getattr(getattr(step, "agent", None), "name", None),
                "summary": _step_summary(step),
                "detail": _trim(_primary_text(step.output or step.input), MAX_SUMMARY_TEXT),
                "status": step.status,
                "created_at": _datetime_iso(step.started_at),
                "source_id": step.id,
                "source_type": "task_step",
            }
        )

    for call in calls:
        events.append(
            {
                "type": "model_call",
                "stage": current_stage,
                "title": call.model_name,
                "actor": getattr(getattr(call, "agent", None), "name", None),
                "summary": _model_call_summary(call),
                "detail": _trim(call.error_message or "", MAX_SUMMARY_TEXT) or None,
                "status": call.status,
                "created_at": _datetime_iso(call.created_at),
                "source_id": call.id,
                "source_type": "model_call",
            }
        )

    events.sort(key=lambda item: (item.get("created_at") or "", item.get("source_id") or 0))
    return events


def _build_trace_summary(
    task: Task,
    current_stage: str,
    steps: Sequence[TaskStep],
    calls: Sequence[ModelCall],
    failure_notes: str | None,
) -> str:
    completed_count = sum(1 for step in steps if step.status == "completed")
    failed_count = sum(1 for step in steps if step.status == "failed")
    tool_count = sum(1 for step in steps if step.step_name == "tool_call")
    call_count = len(calls)
    lines = [
        f"任务 #{task.id} · {task.title}",
        f"当前阶段：{_stage_summary(current_stage)}",
        f"已完成步骤：{completed_count}，失败步骤：{failed_count}，模型调用：{call_count}，工具调用：{tool_count}",
    ]
    if steps:
        lines.append("最近步骤：")
        for step in steps[-min(4, len(steps)):]:
            lines.append(f"- {_step_summary(step)}")
    if failure_notes:
        lines.append(f"失败原因：{_trim(failure_notes, 220)}")
    return "\n".join(lines)


def _stage_summary(current_stage: str) -> str:
    if current_stage.startswith("worker_execute"):
        return f"Worker 执行（{current_stage}）"
    return _STAGE_LABELS.get(current_stage, current_stage)


def _step_snapshot(step: TaskStep) -> dict[str, Any]:
    return {
        "id": step.id,
        "step_name": step.step_name,
        "status": step.status,
        "agent": getattr(getattr(step, "agent", None), "name", None),
        "started_at": _datetime_iso(step.started_at),
        "finished_at": _datetime_iso(step.finished_at),
        "input": _trim(_primary_text(step.input), MAX_CONTEXT_TEXT),
        "output": _trim(_primary_text(step.output), MAX_CONTEXT_TEXT),
    }


def _model_call_snapshot(call: ModelCall) -> dict[str, Any]:
    return {
        "id": call.id,
        "model_name": call.model_name,
        "provider": call.provider,
        "status": call.status,
        "agent": getattr(getattr(call, "agent", None), "name", None),
        "latency_ms": call.latency_ms,
        "error_message": _trim(call.error_message, MAX_CONTEXT_TEXT),
        "created_at": _datetime_iso(call.created_at),
    }


def _recent_tool_results(steps: Sequence[TaskStep]) -> list[dict[str, Any]]:
    tool_steps = [step for step in steps if step.step_name == "tool_call"]
    return [
        {
            "step_id": step.id,
            "tool_name": _extract_tool_name(step.input),
            "tool_arguments": _extract_tool_arguments(step.input),
            "tool_result": _trim(_primary_text(step.output), MAX_CONTEXT_TEXT),
            "status": step.status,
            "started_at": _datetime_iso(step.started_at),
            "finished_at": _datetime_iso(step.finished_at),
        }
        for step in tool_steps[-MAX_CONTEXT_ITEMS:]
    ]


def _open_issues(
    steps: Sequence[TaskStep],
    calls: Sequence[ModelCall],
    failure_notes: str | None,
) -> list[str]:
    issues: list[str] = []
    if failure_notes:
        issues.append(_trim(failure_notes, 300))
    for step in reversed(steps):
        if step.status == "failed":
            issues.append(f"步骤失败：{step.step_name}")
            break
    for call in reversed(calls):
        if call.status == "failed" and call.error_message:
            issues.append(f"模型调用失败：{_trim(call.error_message, 300)}")
            break
    return issues[:3]


def _step_summary(step: TaskStep) -> str:
    agent_name = getattr(getattr(step, "agent", None), "name", None) or "系统"
    summary = f"{agent_name} · {step.step_name} · {step.status}"
    detail = _trim(_primary_text(step.output or step.input), 120)
    return f"{summary} · {detail}" if detail else summary


def _model_call_summary(call: ModelCall) -> str:
    actor = getattr(getattr(call, "agent", None), "name", None) or "未知 Agent"
    parts = [actor, call.model_name, call.status]
    if call.latency_ms is not None:
        parts.append(f"{call.latency_ms}ms")
    return " · ".join(parts)


def _event_type_for_step(step: TaskStep) -> str:
    if step.step_name == "tool_call":
        return "tool_call"
    return f"step_{step.status}"


def _extract_tool_name(raw_value: str | None) -> str | None:
    if not raw_value:
        return None
    try:
        payload = json.loads(raw_value)
    except json.JSONDecodeError:
        return None
    name = payload.get("name") if isinstance(payload, dict) else None
    return str(name) if isinstance(name, str) and name else None


def _extract_tool_arguments(raw_value: str | None) -> str | None:
    if not raw_value:
        return None
    try:
        payload = json.loads(raw_value)
    except json.JSONDecodeError:
        return None
    arguments = payload.get("arguments") if isinstance(payload, dict) else None
    return str(arguments) if isinstance(arguments, str) and arguments else None


def _primary_text(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        return value
    return str(value)


def _trim(value: str | None, max_length: int) -> str | None:
    if value is None:
        return None
    text = value.strip()
    if len(text) <= max_length:
        return text
    return text[: max_length - 1] + "…"


def _datetime_iso(value: datetime | None) -> str | None:
    return value.isoformat() if value is not None else None


def _agent_snapshot(agent: Agent | None) -> dict[str, Any] | None:
    if agent is None:
        return None
    return {
        "id": agent.id,
        "name": agent.name,
        "role": agent.role,
        "status": getattr(agent, "status", None),
    }


__all__ = [
    "TraceArtifact",
    "build_context_message",
    "build_execution_trace",
    "build_trace_artifact",
    "build_trace_summary",
]
