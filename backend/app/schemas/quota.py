from datetime import datetime
from pydantic import BaseModel


class QuotaConfigRead(BaseModel):
    id: int
    workspace_id: int
    monthly_budget_usd: float
    max_monthly_tokens: int
    max_concurrent_tasks: int
    rate_limit_per_minute: int
    is_hard_limit: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class QuotaConfigUpdate(BaseModel):
    monthly_budget_usd: float | None = None
    max_monthly_tokens: int | None = None
    max_concurrent_tasks: int | None = None
    rate_limit_per_minute: int | None = None
    is_hard_limit: bool | None = None


class QuotaUsageRead(BaseModel):
    workspace_id: int
    monthly_spent_usd: float
    monthly_tokens_used: int
    budget_usd: float
    token_limit: int
    max_concurrent_tasks: int
    is_hard_limit: bool
    percent_spent: float
    is_exceeded: bool
