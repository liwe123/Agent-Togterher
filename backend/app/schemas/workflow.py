from datetime import datetime
from typing import Any
from pydantic import BaseModel, Field


class WorkflowNode(BaseModel):
    id: str
    name: str
    agent_role: str
    prompt_template: str
    dependencies: list[str] = Field(default_factory=list)


class WorkflowVariable(BaseModel):
    key: str
    label: str
    description: str = ""
    default: str | None = None
    required: bool = True


class WorkflowTemplateCreate(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    display_name: str = Field(min_length=2, max_length=255)
    description: str | None = None
    icon: str = "workflow"
    nodes: list[WorkflowNode] = Field(min_length=1)
    variables: list[WorkflowVariable] = Field(default_factory=list)


class WorkflowTemplateResponse(BaseModel):
    id: int
    workspace_id: int | None
    name: str
    display_name: str
    description: str | None
    icon: str
    is_system: bool
    nodes: list[WorkflowNode]
    variables: list[WorkflowVariable]
    nodes_count: int
    created_at: datetime
    updated_at: datetime


class WorkflowRunRequest(BaseModel):
    variables: dict[str, str] = Field(default_factory=dict)
    custom_title: str | None = None


class WorkflowRunResponse(BaseModel):
    task_id: int
    workflow_id: int
    title: str
    status: str
    message: str
