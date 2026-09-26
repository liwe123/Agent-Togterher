import json
from typing import Any
from fastapi import APIRouter, Depends, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.errors import AppError
from app.api.rbac_compat import enforce_workspace_role
from app.core.config import get_settings
from app.core.message_hub import dispatch_background_task
from app.db.base import utc_now
from app.db.session import get_db
from app.models import TaskQueueItem, TaskStatus
from app.models.agent import Agent
from app.models.model_call import ModelCall
from app.models.task import Task, TaskStep
from app.schemas.common import SuccessResponse
from app.schemas.replay import (
    ReplayFrame,
    ResumeStepRequest,
    TaskReplayResponse,
)
from app.services.audit_service import record_audit_log
from app.services.task_service import QUEUE_TERMINAL_STATUSES, TaskService

router = APIRouter(prefix="/tasks/{task_id}", tags=["task-replay"])

# 可恢复的任务状态：执行中（RUNNING / WAITING_APPROVAL）与终态（COMPLETED）
# 不允许通过"恢复"重新调度，避免与进行中的执行体抢占同一任务。
_RESUMABLE_TASK_STATUSES = {
    TaskStatus.PENDING,
    TaskStatus.FAILED,
    TaskStatus.CANCELLED,
}


@router.get("/replay", response_model=SuccessResponse[TaskReplayResponse])
async def get_task_replay_timeline(
    task_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """获取任务结构化时序执行回放流。"""
    task = await db.get(Task, task_id)
    if task is None:
        raise AppError(status_code=404, message="任务不存在")
    await enforce_workspace_role(
        request, db, workspace_id=task.workspace_id, min_role="viewer"
    )

    # Fetch all steps for this task
    steps_query = (
        select(TaskStep, Agent.role)
        .outerjoin(Agent, TaskStep.agent_id == Agent.id)
        .where(TaskStep.task_id == task_id)
        .order_by(TaskStep.id.asc())
    )
    step_rows = (await db.execute(steps_query)).all()

    # Fetch all model calls for this task
    calls_query = (
        select(ModelCall)
        .where(ModelCall.task_id == task_id)
        .order_by(ModelCall.created_at.asc())
    )
    model_calls = (await db.scalars(calls_query)).all()

    total_cost = sum(float(c.cost) for c in model_calls)

    frames: list[ReplayFrame] = []
    for step, agent_role in step_rows:
        input_data = None
        output_data = None
        if step.input:
            try:
                input_data = json.loads(step.input)
            except Exception:
                input_data = {"raw": step.input}
        if step.output:
            try:
                output_data = json.loads(step.output)
            except Exception:
                output_data = {"raw": step.output}

        step_calls = [
            c for c in model_calls
            if (step.started_at is None or c.created_at >= step.started_at)
            and (step.finished_at is None or c.created_at <= step.finished_at)
        ]
        step_tokens = sum(c.prompt_tokens + c.completion_tokens for c in step_calls)
        step_cost = sum(float(c.cost) for c in step_calls)

        duration_ms = None
        if step.started_at and step.finished_at:
            duration_ms = int((step.finished_at - step.started_at).total_seconds() * 1000)

        frames.append(
            ReplayFrame(
                step_id=step.id,
                step_name=step.step_name,
                agent_role=agent_role,
                status=step.status,
                started_at=step.started_at,
                completed_at=step.finished_at,
                duration_ms=duration_ms,
                input_payload=input_data,
                output_payload=output_data,
                # P0-6：失败步骤的错误文本由 orchestrator/DAG 持久化在 output 中
                # （见 orchestrator._mark_failed / dag_engine 失败分支）。
                error_message=(step.output if step.status == "failed" else None),
                model_calls_count=len(step_calls),
                tokens_used=step_tokens,
                cost_usd=round(step_cost, 6),
            )
        )

    total_duration = None
    if step_rows:
        first_step = step_rows[0][0]
        last_step = step_rows[-1][0]
        if first_step.started_at and last_step.finished_at:
            total_duration = int((last_step.finished_at - first_step.started_at).total_seconds() * 1000)

    return SuccessResponse(
        data=TaskReplayResponse(
            task_id=task.id,
            title=task.title,
            status=task.status.value if hasattr(task.status, "value") else str(task.status),
            total_duration_ms=total_duration,
            total_cost_usd=round(total_cost, 6),
            frames=frames,
        )
    )


@router.post("/resume-from-step", response_model=SuccessResponse[dict[str, Any]])
async def resume_task_from_step(
    task_id: int,
    body: ResumeStepRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """从指定失败或中断的步骤重新调度任务（带历史上下文续跑）。

    当前 orchestrator 尚不支持真正的"跳过已完成步骤"式续跑：本端点把
    目标任务重新置为 PENDING 并**真实入队 / 派发**（queue 模式交由独立
    Worker 认领，inline 模式就地调度），执行体会基于既有步骤上下文重跑。
    ``custom_instruction`` 会追加到任务描述，供执行体在续跑时读取。
    """
    task = await db.get(Task, task_id)
    if task is None:
        raise AppError(status_code=404, message="任务不存在")
    membership = await enforce_workspace_role(
        request, db, workspace_id=task.workspace_id, min_role="member"
    )

    step = await db.get(TaskStep, body.step_id)
    if step is None or step.task_id != task_id:
        raise AppError(status_code=404, message="指定步骤不存在或不属于该任务")

    if task.status not in _RESUMABLE_TASK_STATUSES:
        raise AppError(
            status_code=409,
            message=f"任务当前状态为 {task.status.value}，无法恢复",
        )
    if step.status == "completed":
        raise AppError(status_code=409, message="该步骤已完成，无需恢复")

    instruction = (body.custom_instruction or "").strip()
    if instruction:
        task.description = (
            f"{(task.description or '').rstrip()}\n\n【恢复指令】{instruction}"
        )

    step.status = "pending"
    step.finished_at = None
    task.status = TaskStatus.PENDING
    task.updated_at = utc_now()
    await db.commit()

    # 队列项复活：TaskService.enqueue 不会复活已完成 / 死信项，需先清掉再入队。
    item = await db.scalar(
        select(TaskQueueItem).where(TaskQueueItem.task_id == task_id)
    )
    if item is not None and item.status in QUEUE_TERMINAL_STATUSES:
        await db.delete(item)
        await db.commit()
    await TaskService(db).enqueue(task)

    # queue 模式下由 Worker 认领执行；inline 模式下就地派发。
    if get_settings().task_execution_mode == "inline":
        dispatch_background_task(task_id)

    # 记录审计日志
    await record_audit_log(
        db,
        workspace_id=task.workspace_id,
        user_id=membership.user_id if membership else None,
        action="task.resume_step",
        resource_type="task_step",
        resource_id=str(body.step_id),
        detail={
            "task_id": task_id,
            "step_name": step.step_name,
            "instruction": instruction or None,
        },
    )

    return SuccessResponse(
        data={
            "task_id": task_id,
            "resumed_step_id": body.step_id,
            "status": "pending",
            "message": "已重新调度任务（带历史上下文续跑）",
        }
    )
