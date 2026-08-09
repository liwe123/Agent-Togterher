from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, computed_field, model_validator

from app.models.enums import TaskStatus


class TaskCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    workspace_id: int = Field(gt=0)
    conversation_id: int | None = Field(default=None, gt=0)
    title: str = Field(min_length=1, max_length=255)
    description: str = ""
    assigned_agent_id: int | None = Field(default=None, gt=0)
    priority: str = Field(default="normal", min_length=1, max_length=20)
    input_message_id: int | None = Field(default=None, gt=0)


class TaskUpdate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    conversation_id: int | None = Field(default=None, gt=0)
    title: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    assigned_agent_id: int | None = Field(default=None, gt=0)
    priority: str | None = Field(default=None, min_length=1, max_length=20)
    input_message_id: int | None = Field(default=None, gt=0)

    @model_validator(mode="after")
    def reject_empty_update_and_null_required_fields(self) -> "TaskUpdate":
        if not self.model_fields_set:
            raise ValueError("At least one field must be provided")
        required = {"title", "description", "priority"}
        if any(field in self.model_fields_set and getattr(self, field) is None for field in required):
            raise ValueError("Required task fields cannot be null")
        return self


class TaskRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    workspace_id: int
    conversation_id: int | None
    title: str
    description: str
    assigned_agent_id: int | None
    status: TaskStatus
    priority: str
    input_message_id: int | None
    result: str | None
    created_at: datetime
    updated_at: datetime


class TaskAgentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    role: str
    avatar: str | None


class TaskListItemRead(TaskRead):
    assigned_agent: TaskAgentRead | None = None


class TaskStepRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    task_id: int
    agent_id: int | None
    agent: TaskAgentRead | None = None
    step_name: str
    input: str | None
    output: str | None
    status: str
    started_at: datetime | None
    finished_at: datetime | None

    @computed_field
    @property
    def duration_ms(self) -> int | None:
        if self.started_at is None or self.finished_at is None:
            return None
        return max(0, int((self.finished_at - self.started_at).total_seconds() * 1000))


class ModelCallRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    task_id: int
    agent_id: int | None
    agent: TaskAgentRead | None = None
    model_name: str
    provider: str
    prompt_tokens: int
    completion_tokens: int
    cost: Decimal
    latency_ms: int | None
    status: str
    error_message: str | None
    created_at: datetime

    @computed_field
    @property
    def total_tokens(self) -> int:
        return self.prompt_tokens + self.completion_tokens


class TaskStepEventPayload(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    task_id: int
    agent_id: int | None = None
    step_name: str
    input: str | None = None
    output: str | None = None
    status: str
    started_at: datetime | None = None
    finished_at: datetime | None = None


class TaskTraceEventRead(BaseModel):
    type: str
    stage: str
    title: str
    actor: str | None = None
    summary: str
    detail: str | None = None
    status: str | None = None
    created_at: str | None = None
    source_id: int | None = None
    source_type: str | None = None


class TaskTokenUsageRead(BaseModel):
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int


class TaskDetailRead(TaskRead):
    assigned_agent: TaskAgentRead | None = None
    original_input: str | None
    task_steps: list[TaskStepRead]
    model_calls: list[ModelCallRead]
    token_usage: TaskTokenUsageRead
    duration_ms: int | None
    execution_trace: list[TaskTraceEventRead] = Field(default_factory=list)
    trace_summary: str | None = None
    context_snapshot: str | None = None
