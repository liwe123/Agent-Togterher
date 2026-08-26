import time
from collections import defaultdict, deque
from dataclasses import dataclass
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


async def _get_monthly_usage(db: AsyncSession, workspace_id: int) -> tuple[float, int]:
    """返回工作区当月累计支出金额与消耗 Token 数。"""
    now = datetime.now(timezone.utc)
    month_start = datetime(now.year, now.month, 1, tzinfo=timezone.utc)

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
    return float(spent_usd), int(tokens_used)


async def get_workspace_quota_usage(db: AsyncSession, workspace_id: int) -> QuotaUsageRead:
    """计算工作区当月支出与配额使用率。"""
    config = await get_or_create_quota_config(db, workspace_id)
    spent_usd, tokens_used = await _get_monthly_usage(db, workspace_id)

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


# 进程内每分钟滑动窗口限流计数。仅覆盖单进程内的派发/建任务入口，
# TODO: 多进程/多实例部署下需替换为 Redis 固定窗口或令牌桶限流，否则各实例各自计数。
_rate_limit_buckets: dict[int, deque[float]] = defaultdict(deque)


def _check_rate_limit(workspace_id: int, limit: int) -> bool:
    """记录一次派发尝试，返回是否仍在每分钟限流窗口内。

    ``limit <= 0`` 表示未启用限流，恒放行。
    """
    if limit <= 0:
        return True
    now = time.monotonic()
    bucket = _rate_limit_buckets[workspace_id]
    cutoff = now - 60.0
    while bucket and bucket[0] < cutoff:
        bucket.popleft()
    if len(bucket) >= limit:
        return False
    bucket.append(now)
    return True


def reset_rate_limit_state() -> None:
    """清空进程内限流计数（供测试隔离使用）。"""
    _rate_limit_buckets.clear()


@dataclass(frozen=True)
class QuotaCheckResult:
    """派发/建任务前的工作区配额校验结果。"""

    workspace_id: int
    is_exceeded: bool
    is_hard_limit: bool
    rate_limited: bool
    rate_limit_per_minute: int
    monthly_spent_usd: float
    monthly_tokens_used: int
    budget_usd: float
    token_limit: int

    @property
    def blocked(self) -> bool:
        """是否需要拦截：限流触发，或超额且开启硬熔断。"""
        return self.rate_limited or (self.is_exceeded and self.is_hard_limit)

    @property
    def block_reason(self) -> str | None:
        if self.rate_limited:
            return (
                f"Rate limit exceeded: max {self.rate_limit_per_minute} requests per minute"
            )
        if self.is_exceeded and self.is_hard_limit:
            return "Workspace quota exceeded and hard limit is enabled; task creation blocked"
        return None


async def check_workspace_quota(
    db: AsyncSession, workspace_id: int
) -> QuotaCheckResult:
    """在派发/建任务前校验工作区配额，返回是否应拦截。

    - 硬熔断（G3）：当月预算或 Token 上限超额且 ``is_hard_limit`` 时 ``blocked``。
    - 软限制：未超额或 ``is_hard_limit=False`` 时放行（仅由调用方记录日志）。
    - 限流（G4）：超过 ``rate_limit_per_minute`` 时 ``blocked``（进程内计数）。
    """
    config = await get_or_create_quota_config(db, workspace_id)
    spent_usd, tokens_used = await _get_monthly_usage(db, workspace_id)

    is_exceeded = (
        spent_usd >= config.monthly_budget_usd
        or tokens_used >= config.max_monthly_tokens
    )
    rate_limited = not _check_rate_limit(workspace_id, config.rate_limit_per_minute)

    return QuotaCheckResult(
        workspace_id=workspace_id,
        is_exceeded=is_exceeded,
        is_hard_limit=config.is_hard_limit,
        rate_limited=rate_limited,
        rate_limit_per_minute=config.rate_limit_per_minute,
        monthly_spent_usd=round(spent_usd, 6),
        monthly_tokens_used=tokens_used,
        budget_usd=config.monthly_budget_usd,
        token_limit=config.max_monthly_tokens,
    )
