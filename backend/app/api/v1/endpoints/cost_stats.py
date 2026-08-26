from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.permissions import require_workspace_role
from app.db.session import get_db
from app.models.membership import WorkspaceMembership
from app.models.model_call import ModelCall
from app.models.task import Task
from app.schemas.common import SuccessResponse
from app.schemas.cost import (
    CostSummaryRead,
    DailyCostItem,
    ModelCostItem,
    TopTaskCostItem,
)

router = APIRouter(prefix="/workspaces/{workspace_id}/cost", tags=["cost-stats"])


@router.get("/summary", response_model=SuccessResponse[CostSummaryRead])
async def get_cost_summary(
    workspace_id: int,
    membership: WorkspaceMembership = Depends(require_workspace_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    """获取工作区成本概览指标。"""
    now = datetime.now(timezone.utc)
    today_start = datetime(now.year, now.month, now.day, tzinfo=timezone.utc)
    month_start = datetime(now.year, now.month, 1, tzinfo=timezone.utc)

    # All-time total
    total_query = (
        select(
            func.coalesce(func.sum(ModelCall.cost), 0.0),
            func.coalesce(func.sum(ModelCall.prompt_tokens + ModelCall.completion_tokens), 0),
            func.count(ModelCall.id),
            func.coalesce(func.avg(ModelCall.latency_ms), 0.0),
        )
        .select_from(ModelCall)
        .join(Task, ModelCall.task_id == Task.id)
        .where(Task.workspace_id == workspace_id)
    )
    total_cost, total_tokens, total_calls, avg_latency = (await db.execute(total_query)).one()

    # Today cost
    today_query = (
        select(func.coalesce(func.sum(ModelCall.cost), 0.0))
        .select_from(ModelCall)
        .join(Task, ModelCall.task_id == Task.id)
        .where(
            Task.workspace_id == workspace_id,
            ModelCall.created_at >= today_start,
        )
    )
    today_cost = (await db.scalar(today_query)) or 0.0

    # Month cost
    month_query = (
        select(func.coalesce(func.sum(ModelCall.cost), 0.0))
        .select_from(ModelCall)
        .join(Task, ModelCall.task_id == Task.id)
        .where(
            Task.workspace_id == workspace_id,
            ModelCall.created_at >= month_start,
        )
    )
    month_cost = (await db.scalar(month_query)) or 0.0

    return SuccessResponse(
        data=CostSummaryRead(
            total_cost_usd=round(float(total_cost), 6),
            today_cost_usd=round(float(today_cost), 6),
            month_cost_usd=round(float(month_cost), 6),
            total_tokens=int(total_tokens),
            total_calls=int(total_calls),
            avg_latency_ms=round(float(avg_latency), 1),
        )
    )


@router.get("/daily-trend", response_model=SuccessResponse[list[DailyCostItem]])
async def get_daily_cost_trend(
    workspace_id: int,
    days: int = Query(default=30, ge=1, le=90),
    membership: WorkspaceMembership = Depends(require_workspace_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    """获取近 N 天每日 Token 与成本趋势。"""
    start_date = datetime.now(timezone.utc) - timedelta(days=days)

    # 按方言选择日期分组表达式：PostgreSQL 用 to_char，其余（SQLite）用 strftime
    bind_dialect = db.bind.dialect.name if db.bind is not None else "sqlite"
    if bind_dialect == "postgresql":
        day_expr = func.to_char(ModelCall.created_at, "YYYY-MM-DD")
    else:
        day_expr = func.strftime("%Y-%m-%d", ModelCall.created_at)

    query = (
        select(
            day_expr.label("day"),
            func.coalesce(func.sum(ModelCall.prompt_tokens), 0).label("prompt_tokens"),
            func.coalesce(func.sum(ModelCall.completion_tokens), 0).label("completion_tokens"),
            func.coalesce(func.sum(ModelCall.cost), 0.0).label("cost"),
            func.count(ModelCall.id).label("call_count"),
        )
        .select_from(ModelCall)
        .join(Task, ModelCall.task_id == Task.id)
        .where(
            Task.workspace_id == workspace_id,
            ModelCall.created_at >= start_date,
        )
        .group_by("day")
        .order_by("day")
    )
    rows = (await db.execute(query)).all()

    items = [
        DailyCostItem(
            date=row.day,
            prompt_tokens=int(row.prompt_tokens),
            completion_tokens=int(row.completion_tokens),
            total_tokens=int(row.prompt_tokens + row.completion_tokens),
            cost_usd=round(float(row.cost), 6),
            call_count=int(row.call_count),
        )
        for row in rows
    ]
    return SuccessResponse(data=items)


@router.get("/by-model", response_model=SuccessResponse[list[ModelCostItem]])
async def get_cost_by_model(
    workspace_id: int,
    membership: WorkspaceMembership = Depends(require_workspace_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    """获取按模型厂商划分的消耗占比。"""
    query = (
        select(
            ModelCall.model_name,
            ModelCall.provider,
            func.coalesce(func.sum(ModelCall.cost), 0.0).label("cost"),
            func.count(ModelCall.id).label("call_count"),
            func.coalesce(func.sum(ModelCall.prompt_tokens + ModelCall.completion_tokens), 0).label("tokens"),
        )
        .select_from(ModelCall)
        .join(Task, ModelCall.task_id == Task.id)
        .where(Task.workspace_id == workspace_id)
        .group_by(ModelCall.model_name, ModelCall.provider)
        .order_by(desc("cost"))
    )
    rows = (await db.execute(query)).all()

    total_cost = sum(float(r.cost) for r in rows) or 1.0

    items = [
        ModelCostItem(
            model_name=row.model_name,
            provider=row.provider,
            cost_usd=round(float(row.cost), 6),
            call_count=int(row.call_count),
            token_count=int(row.tokens),
            percentage=round((float(row.cost) / total_cost) * 100, 1),
        )
        for row in rows
    ]
    return SuccessResponse(data=items)


@router.get("/top-tasks", response_model=SuccessResponse[list[TopTaskCostItem]])
async def get_top_cost_tasks(
    workspace_id: int,
    limit: int = Query(default=10, ge=1, le=50),
    membership: WorkspaceMembership = Depends(require_workspace_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    """获取算力与费用消耗最高的任务排行榜。"""
    query = (
        select(
            Task.id.label("task_id"),
            Task.title.label("task_title"),
            Task.status.label("status"),
            Task.created_at.label("created_at"),
            func.coalesce(func.sum(ModelCall.cost), 0.0).label("cost"),
            func.coalesce(func.sum(ModelCall.prompt_tokens + ModelCall.completion_tokens), 0).label("tokens"),
            func.count(ModelCall.id).label("model_call_count"),
        )
        .join(ModelCall, Task.id == ModelCall.task_id)
        .where(Task.workspace_id == workspace_id)
        .group_by(Task.id, Task.title, Task.status, Task.created_at)
        .order_by(desc("cost"))
        .limit(limit)
    )
    rows = (await db.execute(query)).all()

    items = [
        TopTaskCostItem(
            task_id=row.task_id,
            task_title=row.task_title,
            status=str(row.status),
            cost_usd=round(float(row.cost), 6),
            total_tokens=int(row.tokens),
            model_call_count=int(row.model_call_count),
            created_at=row.created_at,
        )
        for row in rows
    ]
    return SuccessResponse(data=items)
