from datetime import datetime
from pydantic import BaseModel, ConfigDict, Field


class WorkflowNode(BaseModel):
    id: str
    name: str
    agent_role: str
    prompt_template: str
    # 节点类型：agent（默认，正常执行）| human_approval（人工审批挂起点，C-184）
    type: str = "agent"
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


class WorkflowRunSummary(BaseModel):
    """运行记录列表项（PRD-工作流运行记录与画布可视化 FR1）。

    命名刻意避开 WorkflowRunResponse：后者是「派发一次运行」的响应契约，
    与「读取历史运行记录」不是一回事。
    """

    model_config = ConfigDict(from_attributes=True)

    id: int
    template_id: int
    task_id: int
    status: str
    created_at: datetime
    updated_at: datetime
    # 运行时快照的节点数（FR3 要求列表展示节点数；快照损坏时按 0 计）
    nodes_count: int = 0


class WorkflowRunDetail(WorkflowRunSummary):
    """单次运行详情（FR2）：附带运行时节点快照，非法/缺失快照容错为空列表。"""

    nodes: list[WorkflowNode] = Field(default_factory=list)
