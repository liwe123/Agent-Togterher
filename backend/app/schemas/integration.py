from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class IntegrationNodeCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    workspace_id: int = Field(gt=0)
    name: str = Field(min_length=1, max_length=100)
    provider: str = Field(min_length=1, max_length=50)
    mode: str = Field(default="bridge", min_length=1, max_length=32)
    status: str = Field(default="offline", min_length=1, max_length=32)
    version: str | None = Field(default=None, max_length=64)
    capabilities: list[str] = Field(default_factory=list)
    endpoint: str | None = Field(default=None, max_length=512)
    config: dict[str, Any] | None = None
    max_concurrency: int = Field(default=1, ge=1, le=64)


class IntegrationNodeUpdate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    name: str | None = Field(default=None, min_length=1, max_length=100)
    provider: str | None = Field(default=None, min_length=1, max_length=50)
    mode: str | None = Field(default=None, min_length=1, max_length=32)
    status: str | None = Field(default=None, min_length=1, max_length=32)
    version: str | None = Field(default=None, max_length=64)
    capabilities: list[str] | None = None
    endpoint: str | None = Field(default=None, max_length=512)
    config: dict[str, Any] | None = None
    current_task_count: int | None = Field(default=None, ge=0, le=64)
    max_concurrency: int | None = Field(default=None, ge=1, le=64)


class IntegrationNodeRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    workspace_id: int
    name: str
    provider: str
    mode: str
    status: str
    version: str | None
    capabilities: list[str]
    endpoint: str | None
    current_task_count: int
    max_concurrency: int
    last_heartbeat_at: datetime | None
    created_at: datetime
    updated_at: datetime


class IntegrationHeartbeat(BaseModel):
    node_id: int = Field(gt=0)
    status: str = Field(default="online", min_length=1, max_length=32)
    version: str | None = Field(default=None, max_length=64)
    capabilities: list[str] = Field(default_factory=list)
    current_task_count: int | None = Field(default=None, ge=0, le=64)


class IntegrationDispatchRequest(BaseModel):
    task_id: int = Field(gt=0)
    node_id: int | None = Field(default=None, gt=0)
    strategy: str = Field(default="manual", min_length=1, max_length=32)
    acceptance_criteria: list[str] | None = None
    allowed_paths: list[str] | None = None
    test_command: str | None = Field(default=None, max_length=2000)
    budget_seconds: int | None = Field(default=None, ge=1, le=86400)
    budget_turns: int | None = Field(default=None, ge=1, le=1000)
    dependencies: list[str] | None = None


class IntegrationDispatchResponse(BaseModel):
    task_id: int
    node_id: int
    node_name: str
    success: bool
    message: str
    artifacts: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)
    status: str = "accepted"
