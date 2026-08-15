from datetime import datetime
from pydantic import BaseModel


class CostSummaryRead(BaseModel):
    total_cost_usd: float
    today_cost_usd: float
    month_cost_usd: float
    total_tokens: int
    total_calls: int
    avg_latency_ms: float


class DailyCostItem(BaseModel):
    date: str
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
    cost_usd: float
    call_count: int


class ModelCostItem(BaseModel):
    model_name: str
    provider: str
    cost_usd: float
    call_count: int
    token_count: int
    percentage: float


class TopTaskCostItem(BaseModel):
    task_id: int
    task_title: str
    status: str
    cost_usd: float
    total_tokens: int
    model_call_count: int
    created_at: datetime
