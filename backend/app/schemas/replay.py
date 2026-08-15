from datetime import datetime
from typing import Any

from pydantic import BaseModel


class ReplayFrame(BaseModel):
    step_id: int
    step_name: str
    agent_role: str | None = None
    status: str
    started_at: datetime | None = None
    completed_at: datetime | None = None
    duration_ms: int | None = None
    input_payload: dict[str, Any] | None = None
    output_payload: dict[str, Any] | None = None
    error_message: str | None = None
    model_calls_count: int = 0
    tokens_used: int = 0
    cost_usd: float = 0.0


class TaskReplayResponse(BaseModel):
    task_id: int
    title: str
    status: str
    total_duration_ms: int | None = None
    total_cost_usd: float = 0.0
    frames: list[ReplayFrame]


class ResumeStepRequest(BaseModel):
    step_id: int
    custom_instruction: str | None = None
