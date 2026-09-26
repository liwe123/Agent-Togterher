import asyncio
import logging
import time
import weakref
from collections import defaultdict, deque
from dataclasses import dataclass
from datetime import datetime, timezone

import redis.asyncio as redis
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models.model_call import ModelCall
from app.models.quota_config import QuotaConfig
from app.models.task import Task
from app.schemas.quota import QuotaConfigUpdate, QuotaUsageRead

logger = logging.getLogger(__name__)


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


# 每分钟限流计数。
# - 主路径：Redis 固定窗口（key=quota:rl:{workspace_id}:{minute}），保证 api + worker
#   多进程部署下计数全局一致（20260907 报告 BUG-2/A2，原为进程内内存计数、多实例失效）。
# - 降级路径：进程内滑动窗口（_rate_limit_buckets），仅在 Redis 不可用时兜底，保证本地
#   无 Redis 开发不被打断。
_redis_rate_limit_client: redis.Redis | None = None
_redis_rate_limit_loop: "weakref.ref[asyncio.AbstractEventLoop] | None" = None
_rate_limit_buckets: dict[int, deque[float]] = defaultdict(deque)
_last_redis_warn_ts: float = 0.0


def _reset_rate_limit_redis() -> None:
    """丢弃当前限流 Redis 客户端（事件循环切换 / 连接失配时调用）。"""
    global _redis_rate_limit_client, _redis_rate_limit_loop
    _redis_rate_limit_client = None
    _redis_rate_limit_loop = None


def _get_rate_limit_redis() -> redis.Redis | None:
    """按运行中的事件循环惰性重建 async Redis client。

    redis.asyncio 的连接池绑定创建它的事件循环；测试中多个 ``TestClient``
    各自新建并关闭事件循环（``uvicorn --reload`` 开发同理），跨循环复用会抛
    ``RuntimeError: got Future attached to a different loop``。这里记录创建时的
    循环并在循环变化时重建，避免把连接池带到已关闭的循环上。
    """
    global _redis_rate_limit_client, _redis_rate_limit_loop
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return None
    cached_loop = (
        _redis_rate_limit_loop() if _redis_rate_limit_loop is not None else None
    )
    if _redis_rate_limit_client is not None and cached_loop is not loop:
        _reset_rate_limit_redis()
    if _redis_rate_limit_client is None:
        try:
            _redis_rate_limit_client = redis.from_url(
                get_settings().redis_url, decode_responses=True
            )
            _redis_rate_limit_loop = weakref.ref(loop)
        except Exception as exc:  # pragma: no cover - 配置错误兜底
            logger.warning("Failed to build Redis client for rate limiting: %s", exc)
            _reset_rate_limit_redis()
    return _redis_rate_limit_client


def _warn_redis_unavailable_once_per_minute() -> None:
    """Redis 降级告警限频：每分钟至多记一次，避免刷日志。"""
    global _last_redis_warn_ts
    now = time.monotonic()
    if now - _last_redis_warn_ts >= 60.0:
        _last_redis_warn_ts = now
        logger.warning(
            "Redis unavailable; rate limiting degraded to in-process sliding window "
            "(multi-instance counting disabled)"
        )


async def _check_rate_limit_redis(workspace_id: int, limit: int) -> bool | None:
    """Redis 固定窗口限流：INCR + 过期；超限返回 False，Redis 故障返回 None 走降级。

    每次调用计数 +1 并返回 ``count <= limit`` 是否仍放行。窗口按分钟取整，
    key 带 TTL 120s（窗口 60s + 余量，避免上一分钟残留占用下一分钟额度）。
    """
    client = _get_rate_limit_redis()
    if client is None:
        return None
    try:
        window = int(time.time() // 60)
        key = f"quota:rl:{workspace_id}:{window}"
        # INCR 计数；仅当该窗口首次计数（返回值 == 1）时才设 TTL，避免重复下发 EXPIRE。
        count = await client.incr(key)
        if int(count) == 1:
            await client.expire(key, 120)
        return int(count) <= limit
    except redis.RedisError as exc:
        logger.debug("Redis rate-limit error for workspace %s: %s", workspace_id, exc)
        _warn_redis_unavailable_once_per_minute()
        return None
    except RuntimeError as exc:
        # 事件循环切换导致连接失配（如测试中多个 TestClient 各建循环）：
        # 重置客户端并在本次降级到进程内计数，下一次调用在新循环上重建。
        logger.debug(
            "Redis rate-limit client bound to a stale event loop; resetting: %s", exc
        )
        _reset_rate_limit_redis()
        return None


def _check_rate_limit_memory(workspace_id: int, limit: int) -> bool:
    """进程内滑动窗口限流（Redis 不可用时的降级路径）。"""
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


async def _check_rate_limit(workspace_id: int, limit: int) -> bool:
    """记录一次派发尝试，返回是否仍在每分钟限流窗口内。

    ``limit <= 0`` 表示未启用限流，恒放行。优先 Redis 固定窗口；Redis 不可用时
    降级到进程内滑动窗口（与旧行为等价）。
    """
    if limit <= 0:
        return True
    redis_result = await _check_rate_limit_redis(workspace_id, limit)
    if redis_result is not None:
        return redis_result
    return _check_rate_limit_memory(workspace_id, limit)


def reset_rate_limit_state() -> None:
    """清空进程内限流计数（供测试隔离使用）。

    Redis 侧窗口依赖测试注入的假 client（monkeypatch _get_rate_limit_redis），
    进程内降级桶在这里清空。
    """
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
    - 限流（G4）：超过 ``rate_limit_per_minute`` 时 ``blocked``（Redis 固定窗口，
      Redis 不可用时降级进程内计数）。
    """
    config = await get_or_create_quota_config(db, workspace_id)
    spent_usd, tokens_used = await _get_monthly_usage(db, workspace_id)

    is_exceeded = (
        spent_usd >= config.monthly_budget_usd
        or tokens_used >= config.max_monthly_tokens
    )
    rate_limited = not await _check_rate_limit(
        workspace_id, config.rate_limit_per_minute
    )

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
