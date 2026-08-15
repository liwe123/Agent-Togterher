from datetime import datetime, timezone
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.model_call import ModelCall
from app.models.quota_config import QuotaConfig
from app.models.task import Task
from app.schemas.quota import QuotaConfigUpdate, QuotaUsageRead


async def get_or_create_quota_config(db: AsyncSession, workspace_id: int) -> QuotaConfig:
    """获取或初始化工作区配额配置。"""
    query = select(QuotaConfig).where(QuotaConfig.workspace_id == workspace_id)
    config = (await db.execute(query)).scalar_one_or_none()
    if config is None:
        config = QuotaConfig(
            workspace_id=workspace_id,
            monthly_budget_usd=100.0,
            max_monthly_tokens=10_000_000,
            max_concurrent_tasks=5,
            rate_limit_per_minute=60,
            is_hard_limit=False,
        )
        db.add(config)
        await db.commit()
        await db.refresh(config)
    return config


async def get_workspace_quota_usage(db: AsyncSession, workspace_id: int) -> QuotaUsageRead:
    """计算工作区当月支出与配额使用率。"""
    config = await get_or_create_quota_config(db, workspace_id)

    now = datetime.now(timezone.utc)
    month_start = datetime(now.year, now.month, 1, tzinfo=timezone.utc)

    # Sum spending and tokens this month
    query = (
        select(
            func.coalesce(func.sum(ModelCall.cost), 0.0),
            func.coalesce(func.sum(ModelCall.prompt_tokens + ModelCall.completion_tokens), 0),
        )
        .select_from(ModelCall)
        .join(Task, ModelCall.task_id == Task.id)
        .where(
            Task.workspace_id == workspace_id,
            ModelCall.created_at >= month_start,
        )
    )
    spent_usd, tokens_used = (await db.execute(query)).one()
    spent_usd = float(spent_usd)
    tokens_used = int(tokens_used)

    percent_spent = round((spent_usd / config.monthly_budget_usd) * 100, 1) if config.monthly_budget_usd > 0 else 0.0
    is_exceeded = spent_usd >= config.monthly_budget_usd or tokens_used >= config.max_monthly_tokens

    return QuotaUsageRead(
        workspace_id=workspace_id,
        monthly_spent_usd=round(spent_usd, 6),
        monthly_tokens_used=tokens_used,
        budget_usd=config.monthly_budget_usd,
        token_limit=config.max_monthly_tokens,
        max_concurrent_tasks=config.max_concurrent_tasks,
        is_hard_limit=config.is_hard_limit,
        percent_spent=percent_spent,
        is_exceeded=is_exceeded,
    )


async def update_quota_config(
    db: AsyncSession, workspace_id: int, update_data: QuotaConfigUpdate
) -> QuotaConfig:
    """更新工作区配额配置。"""
    config = await get_or_create_quota_config(db, workspace_id)
    if update_data.monthly_budget_usd is not None:
        config.monthly_budget_usd = update_data.monthly_budget_usd
    if update_data.max_monthly_tokens is not None:
        config.max_monthly_tokens = update_data.max_monthly_tokens
    if update_data.max_concurrent_tasks is not None:
        config.max_concurrent_tasks = update_data.max_concurrent_tasks
    if update_data.rate_limit_per_minute is not None:
        config.rate_limit_per_minute = update_data.rate_limit_per_minute
    if update_data.is_hard_limit is not None:
        config.is_hard_limit = update_data.is_hard_limit

    await db.commit()
    await db.refresh(config)
    return config
