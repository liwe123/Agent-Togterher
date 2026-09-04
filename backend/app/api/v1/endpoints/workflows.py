import asyncio
import json
from typing import Any
from fastapi import APIRouter, Depends
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.errors import AppError
from app.core.permissions import require_workspace_role
from app.db.session import get_db
from app.models.enums import TaskStatus
from app.models.membership import WorkspaceMembership
from app.models.task import Task
from app.models.workflow import WorkflowRun, WorkflowTemplate
from app.models.workspace import Workspace
from app.schemas.common import SuccessResponse
from app.schemas.workflow import (
    WorkflowNode,
    WorkflowRunRequest,
    WorkflowRunResponse,
    WorkflowTemplateCreate,
    WorkflowTemplateResponse,
    WorkflowVariable,
)
from app.services.audit_service import record_audit_log
from app.services.dag_engine import (
    build_dag_summary,
    parse_nodes,
    run_workflow_dag,
    topological_sort,
)
from app.services.quota_service import check_workspace_quota

router = APIRouter(prefix="/workspaces/{workspace_id}/workflows", tags=["workflows"])

# C-185: 进程内后台 DAG 执行任务的强引用集合，防止被 GC 回收。
_background_dag_runs: set[asyncio.Task[None]] = set()

SYSTEM_PRESET_TEMPLATES = [
    {
        "name": "fullstack-feature-dev",
        "display_name": "全栈功能敏捷开发流水线",
        "description": "Orchestrator 任务拆解 -> Coder 编码生成 -> Reviewer 审查校验 -> Manager 最终总结",
        "icon": "code",
        "nodes": [
            {
                "id": "node-1",
                "name": "架构设计与任务拆解",
                "agent_role": "manager",
                "prompt_template": "请为功能「{{feature_name}}」设计技术方案并拆解为子任务，技术栈选用 {{tech_stack}}。",
                "dependencies": [],
            },
            {
                "id": "node-2",
                "name": "核心业务代码生成",
                "agent_role": "coder",
                "prompt_template": "根据方案实现「{{feature_name}}」的代码逻辑，遵循 {{code_style}} 规范。",
                "dependencies": ["node-1"],
            },
            {
                "id": "node-3",
                "name": "代码安全与逻辑审查",
                "agent_role": "reviewer",
                "prompt_template": "审查「{{feature_name}}」的代码实现，检查潜在 Bug、类型安全与异常处理。",
                "dependencies": ["node-2"],
            },
        ],
        "variables": [
            {
                "key": "feature_name",
                "label": "功能模块名称",
                "description": "例如：用户个人中心头像上传",
                "default": "用户个人中心",
                "required": True,
            },
            {
                "key": "tech_stack",
                "label": "前端与后端技术栈",
                "description": "例如：Next.js + FastAPI",
                "default": "Next.js 16 + FastAPI",
                "required": True,
            },
            {
                "key": "code_style",
                "label": "代码规范与约束",
                "description": "例如：TypeScript strict + Python type hints",
                "default": "严格类型校验与完整异常处理",
                "required": False,
            },
        ],
    },
    {
        "name": "research-analysis-report",
        "display_name": "深度技术调研与分析报告",
        "description": "Researcher 多维信息搜集 -> Analyst 数据提炼 -> Manager 生成决策研报",
        "icon": "sparkles",
        "nodes": [
            {
                "id": "node-1",
                "name": "行业前沿与资料搜集",
                "agent_role": "researcher",
                "prompt_template": "全面调研主题「{{research_topic}}」的技术背景、主流方案与发展现状。",
                "dependencies": [],
            },
            {
                "id": "node-2",
                "name": "优劣势多维对比分析",
                "agent_role": "analyst",
                "prompt_template": "对「{{research_topic}}」搜集到的方案进行架构、成本、性能与生态多维对比。",
                "dependencies": ["node-1"],
            },
            {
                "id": "node-3",
                "name": "研报总结与落地建议",
                "agent_role": "manager",
                "prompt_template": "基于前序分析，输出「{{research_topic}}」的最终决策报告与落地实施路线图。",
                "dependencies": ["node-2"],
            },
        ],
        "variables": [
            {
                "key": "research_topic",
                "label": "调研主题与核心问题",
                "description": "例如：PostgreSQL vs ClickHouse 在实时分析场景下的选型对比",
                "default": "PostgreSQL vs ClickHouse 实时日志选型",
                "required": True,
            },
        ],
    },
]


@router.get("", response_model=SuccessResponse[list[WorkflowTemplateResponse]])
async def list_workflow_templates(
    workspace_id: int,
    db: AsyncSession = Depends(get_db),
):
    """获取指定工作区可用的全部工作流模板（包含系统全局模板与工作区自定义模板）。"""
    # 自动种子初始化系统预设（如果尚无预设）
    system_count = await db.scalar(
        select(WorkflowTemplate).where(WorkflowTemplate.is_system.is_(True))
    )
    if not system_count:
        for preset in SYSTEM_PRESET_TEMPLATES:
            tpl = WorkflowTemplate(
                workspace_id=None,
                name=preset["name"],
                display_name=preset["display_name"],
                description=preset["description"],
                icon=preset["icon"],
                nodes_json=json.dumps(preset["nodes"]),
                variables_json=json.dumps(preset["variables"]),
                is_system=True,
            )
            db.add(tpl)
        await db.commit()

    query = (
        select(WorkflowTemplate)
        .where(
            or_(
                WorkflowTemplate.is_system.is_(True),
                WorkflowTemplate.workspace_id == workspace_id,
            )
        )
        .order_by(WorkflowTemplate.is_system.desc(), WorkflowTemplate.id.asc())
    )
    templates = (await db.scalars(query)).all()

    result: list[WorkflowTemplateResponse] = []
    for t in templates:
        nodes: list[WorkflowNode] = []
        variables: list[WorkflowVariable] = []
        try:
            raw_nodes = json.loads(t.nodes_json)
            nodes = [WorkflowNode(**n) for n in raw_nodes]
        except Exception:
            pass

        if t.variables_json:
            try:
                raw_vars = json.loads(t.variables_json)
                variables = [WorkflowVariable(**v) for v in raw_vars]
            except Exception:
                pass

        result.append(
            WorkflowTemplateResponse(
                id=t.id,
                workspace_id=t.workspace_id,
                name=t.name,
                display_name=t.display_name,
                description=t.description,
                icon=t.icon or "workflow",
                is_system=t.is_system,
                nodes=nodes,
                variables=variables,
                nodes_count=len(nodes),
                created_at=t.created_at,
                updated_at=t.updated_at,
            )
        )

    return SuccessResponse(data=result)


@router.post("", response_model=SuccessResponse[WorkflowTemplateResponse])
async def create_workflow_template(
    workspace_id: int,
    payload: WorkflowTemplateCreate,
    membership: WorkspaceMembership = Depends(require_workspace_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    """创建工作区自定义工作流模板（仅 Admin 及以上角色）。"""
    tpl = WorkflowTemplate(
        workspace_id=workspace_id,
        name=payload.name,
        display_name=payload.display_name,
        description=payload.description,
        icon=payload.icon,
        nodes_json=json.dumps([n.model_dump() for n in payload.nodes]),
        variables_json=json.dumps([v.model_dump() for v in payload.variables]),
        is_system=False,
    )
    db.add(tpl)
    await db.commit()
    await db.refresh(tpl)

    await record_audit_log(
        db,
        workspace_id=workspace_id,
        user_id=membership.user_id,
        action="workflow.create",
        resource_type="workflow_template",
        resource_id=str(tpl.id),
        detail={"name": tpl.name, "display_name": tpl.display_name},
    )

    return SuccessResponse(
        data=WorkflowTemplateResponse(
            id=tpl.id,
            workspace_id=tpl.workspace_id,
            name=tpl.name,
            display_name=tpl.display_name,
            description=tpl.description,
            icon=tpl.icon or "workflow",
            is_system=tpl.is_system,
            nodes=payload.nodes,
            variables=payload.variables,
            nodes_count=len(payload.nodes),
            created_at=tpl.created_at,
            updated_at=tpl.updated_at,
        )
    )


@router.post("/{template_id}/run", response_model=SuccessResponse[WorkflowRunResponse])
async def run_workflow_template(
    workspace_id: int,
    template_id: int,
    payload: WorkflowRunRequest,
    membership: WorkspaceMembership = Depends(require_workspace_role("member")),
    db: AsyncSession = Depends(get_db),
):
    """根据参数实例化工作流模板，按 DAG 编排创建任务并调度执行（C-185）。

    节点数组经拓扑分层后由后台 DAG 引擎按层并行执行；每个节点执行
    独立落库 task_steps（带 node_id / dependencies_json / order_index）。
    响应契约与旧实现保持一致（task_id / workflow_id / title / status /
    message）。
    """
    tpl = await db.get(WorkflowTemplate, template_id)
    if tpl is None or (not tpl.is_system and tpl.workspace_id != workspace_id):
        raise AppError(status_code=404, message="工作流模板不存在")

    # 接入工作区配额硬熔断与限流：超额（硬熔断）或超每分钟速率时拒绝建任务。
    quota = await check_workspace_quota(db, workspace_id)
    if quota.blocked:
        raise AppError(status_code=429, message=quota.block_reason or "工作区配额已超限")

    # 解析节点并渲染变量占位符 {{var}}
    raw_nodes = parse_nodes(tpl.nodes_json)
    if not raw_nodes:
        raise AppError(status_code=422, message="工作流模板未配置任何节点，无法运行")
    nodes_data: list[dict[str, Any]] = []
    for node in raw_nodes:
        rendered = dict(node)
        prompt_t = str(node.get("prompt_template", ""))
        for k, v in payload.variables.items():
            prompt_t = prompt_t.replace(f"{{{{{k}}}}}", str(v))
        rendered["prompt_template"] = prompt_t
        nodes_data.append(rendered)

    # C-185: DAG 校验（缺 id / 未知依赖 / 环）→ 422
    try:
        layers = topological_sort(nodes_data)
    except ValueError as exc:
        raise AppError(status_code=422, message=str(exc)) from exc

    prompt_sections = []
    for idx, node in enumerate(nodes_data, 1):
        prompt_sections.append(
            f"步骤 {idx} [{node.get('name', '未命名步骤')}] (执行角色: {node.get('agent_role', 'agent')}):\n{node.get('prompt_template', '')}"
        )
    full_prompt = f"【执行工作流流水线：{tpl.display_name}】\n\n" + "\n\n".join(prompt_sections)
    full_prompt += f"\n\n【DAG 编排概览】\n{build_dag_summary(layers)}"

    title = payload.custom_title or f"流水线：{tpl.display_name}"
    if payload.variables:
        first_val = next(iter(payload.variables.values()), "")
        if first_val:
            title = f"{tpl.display_name} - {first_val}"

    # 创建任务实体
    task = Task(
        workspace_id=workspace_id,
        title=title[:255],
        description=full_prompt,
        status=TaskStatus.PENDING,
    )
    db.add(task)
    await db.commit()
    await db.refresh(task)

    # C-185: 运行记录（快照存渲染后的节点数组；终态由引擎回写）
    workflow_run = WorkflowRun(
        template_id=tpl.id,
        task_id=task.id,
        status="running",
        snapshot_nodes_json=json.dumps(nodes_data, ensure_ascii=False),
    )
    db.add(workflow_run)
    await db.commit()
    await db.refresh(workflow_run)

    # 进程内后台执行 DAG（inline 路径；不入 task_queue，PRD 已注明）
    dag_task = asyncio.create_task(
        run_workflow_dag(task.id, workflow_run.id, layers)
    )
    _background_dag_runs.add(dag_task)
    dag_task.add_done_callback(_background_dag_runs.discard)

    await record_audit_log(
        db,
        workspace_id=workspace_id,
        user_id=membership.user_id,
        action="workflow.run",
        resource_type="task",
        resource_id=str(task.id),
        detail={
            "workflow_id": template_id,
            "workflow_name": tpl.name,
            "task_id": task.id,
            "workflow_run_id": workflow_run.id,
            "dag_layers": len(layers),
            "dag_nodes": len(nodes_data),
        },
    )

    return SuccessResponse(
        data=WorkflowRunResponse(
            task_id=task.id,
            workflow_id=tpl.id,
            title=task.title,
            status="pending",
            message=f"已基于工作流「{tpl.display_name}」成功创建 DAG 任务 #{task.id}（共 {len(nodes_data)} 个节点 / {len(layers)} 层），等待调度执行",
        )
    )


@router.delete("/{template_id}", response_model=SuccessResponse[dict[str, Any]])
async def delete_workflow_template(
    workspace_id: int,
    template_id: int,
    membership: WorkspaceMembership = Depends(require_workspace_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    """删除工作区自定义工作流模板（仅 Admin 及以上角色，系统预设不可删除）。"""
    tpl = await db.get(WorkflowTemplate, template_id)
    if tpl is None:
        raise AppError(status_code=404, message="工作流模板不存在")

    if tpl.is_system:
        raise AppError(status_code=403, message="系统预设工作流模板不可删除")

    if tpl.workspace_id != workspace_id:
        raise AppError(status_code=404, message="工作区自定义工作流模板不存在")

    await db.delete(tpl)
    await db.commit()

    await record_audit_log(
        db,
        workspace_id=workspace_id,
        user_id=membership.user_id,
        action="workflow.delete",
        resource_type="workflow_template",
        resource_id=str(template_id),
        detail={"workflow_name": tpl.name},
    )

    return SuccessResponse(data={"deleted_id": template_id, "message": "工作流模板已成功删除"})
