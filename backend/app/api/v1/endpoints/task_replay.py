from datetime import datetime, timezone
import json
from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.errors import AppError
from app.db.session import get_db
from app.models.model_call import ModelCall
from app.models.task import Task, TaskStep
from app.schemas.common import SuccessResponse
from app.schemas.replay import (
    ReplayFrame,
    ResumeStepRequest,
    TaskReplayResponse,
)
from app.services.audit_service import record_audit_log

router = APIRouter(prefix="/tasks/{task_id}", tags=["task-replay"])


@router.get("/replay", response_model=SuccessResponse[TaskReplayResponse])
async def get_task_replay_timeline(
    task_id: int,
    db: AsyncSession = Depends(get_db),
):
    """获取任务结构化时序执行回放流。"""
    task = await db.get(Task, task_id)
    if task is None:
        raise AppError(status_code=404, message="任务不存在")

    # Fetch all steps for this task
    steps_query = (
        select(TaskStep)
        .where(TaskStep.task_id == task_id)
        .order_by(TaskStep.created_at.asc())
    )
    steps = (await db.scalars(steps_query)).all()

    # Fetch all model calls for this task
    calls_query = (
        select(ModelCall)
        .where(ModelCall.task_id == task_id)
        .order_by(ModelCall.created_at.asc())
    )
    model_calls = (await db.scalars(calls_query)).all()

    total_cost = sum(float(c.cost) for c in model_calls)

    frames: list[ReplayFrame] = []
    for step in steps:
        input_data = None
        output_data = None
        if step.input_payload:
            try:
                input_data = json.loads(step.input_payload)
            except Exception:
                input_data = {"raw": step.input_payload}
        if step.output_payload:
            try:
                output_data = json.loads(step.output_payload)
            except Exception:
                output_data = {"raw": step.output_payload}

        step_calls = [c for c in model_calls if c.created_at >= step.created_at and (step.completed_at is None or c.created_at <= step.completed_at)]
        step_tokens = sum(c.prompt_tokens + c.completion_tokens for c in step_calls)
        step_cost = sum(float(c.cost) for c in step_calls)

        frames.append(
            ReplayFrame(
                step_id=step.id,
                step_name=step.step_name,
                agent_role=step.agent_role,
                status=step.status,
                started_at=step.started_at or step.created_at,
                completed_at=step.completed_at,
                duration_ms=step.duration_ms,
                input_payload=input_data,
                output_payload=output_data,
                error_message=step.error_message,
                model_calls_count=len(step_calls),
                tokens_used=step_tokens,
                cost_usd=round(step_cost, 6),
            )
        )

    # Calculate total duration if timestamps available
    total_duration = None
    if steps and steps[0].created_at and steps[-1].completed_at:
        total_duration = int((steps[-1].completed_at - steps[0].created_at).total_seconds() * 1000)

    return SuccessResponse(
        data=TaskReplayResponse(
            task_id=task.id,
            title=task.title,
            status=task.status,
            total_duration_ms=total_duration,
            total_cost_usd=round(total_cost, 6),
            frames=frames,
        )
    )


@router.post("/resume-from-step", response_model=SuccessResponse[dict[str, Any]])
async def resume_task_from_step(
    task_id: int,
    body: ResumeStepRequest,
    db: AsyncSession = Depends(get_db),
):
    """从指定失败或中断的步骤恢复并重新执行任务。"""
    task = await db.get(Task, task_id)
    if task is None:
        raise AppError(status_code=404, message="任务不存在")

    step = await db.get(TaskStep, body.step_id)
    if step is None or step.task_id != task_id:
        raise AppError(status_code=404, message="指定步骤不存在或不属于该任务")

    # Reset step status to pending and task to pending
    step.status = "pending"
    step.error_message = None
    step.completed_at = None
    task.status = "pending"
    task.error_message = None

    await db.commit()

    # 记录审计日志
    await record_audit_log(
        db,
        workspace_id=task.workspace_id,
        action="task.resume_step",
        resource_type="task_step",
        resource_id=str(body.step_id),
        detail={"task_id": task_id, "step_name": step.step_name, "instruction": body.custom_instruction},
    )

    return SuccessResponse(
        data={
            "task_id": task_id,
            "resumed_step_id": body.step_id,
            "status": "pending",
            "message": f"已成功从步骤 {step.step_name} 恢复任务调度",
        }
    )
