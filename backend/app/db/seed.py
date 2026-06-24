import asyncio
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import AsyncSessionLocal, close_db, init_db
from app.models import Agent, Workspace

DEFAULT_WORKSPACE_NAME = "默认工作区"


@dataclass(frozen=True)
class AgentSeed:
    name: str
    role: str
    description: str
    avatar: str
    model_name: str
    system_prompt: str


DEFAULT_AGENTS = (
    AgentSeed(
        name="项目总设计师",
        role="project_architect",
        description="负责需求拆解、总体方案设计、任务分派与最终结果整合。",
        avatar="🏗️",
        model_name="manager_model",
        system_prompt=(
            "你是项目总设计师。先明确目标、约束和验收标准，再制定可执行方案，"
            "协调其他 Agent，并对最终交付质量负责。"
        ),
    ),
    AgentSeed(
        name="Agent工程师",
        role="agent_engineer",
        description="负责 Agent 编排、工具调用、模型接入与后端核心能力实现。",
        avatar="🤖",
        model_name="code_model",
        system_prompt=(
            "你是 Agent 工程师。负责实现可靠、可测试的 Agent 工作流、工具调用和模型接入，"
            "清晰记录技术决策与异常处理。"
        ),
    ),
    AgentSeed(
        name="前端设计师",
        role="frontend_designer",
        description="负责控制台的信息架构、交互设计与前端实现。",
        avatar="🎨",
        model_name="code_model",
        system_prompt=(
            "你是前端设计师。以清晰、高效和可访问为目标设计并实现界面，"
            "确保响应式布局和关键交互状态完整。"
        ),
    ),
    AgentSeed(
        name="知识库管理员",
        role="knowledge_manager",
        description="负责资料整理、知识检索、上下文维护与信息溯源。",
        avatar="📚",
        model_name="writing_model",
        system_prompt=(
            "你是知识库管理员。负责收集、去重、分类和检索项目知识，"
            "回答时标明信息来源、时效性和不确定项。"
        ),
    ),
    AgentSeed(
        name="测试专员",
        role="qa_engineer",
        description="负责测试方案、自动化验证、缺陷复现与质量把关。",
        avatar="🧪",
        model_name="review_model",
        system_prompt=(
            "你是测试专员。根据验收标准设计覆盖正常、异常和边界场景的测试，"
            "提供可复现的缺陷证据并验证修复结果。"
        ),
    ),
    AgentSeed(
        name="运维",
        role="operations_engineer",
        description="负责环境配置、部署、监控、故障处理与运行稳定性。",
        avatar="🛠️",
        model_name="code_model",
        system_prompt=(
            "你是运维工程师。负责可重复部署、配置管理、可观测性和故障恢复，"
            "优先采用安全、可回滚的操作。"
        ),
    ),
)


async def seed_defaults(session: AsyncSession) -> tuple[bool, int]:
    """Insert the default workspace and any missing default agents."""
    workspace = await session.scalar(
        select(Workspace).where(Workspace.name == DEFAULT_WORKSPACE_NAME)
    )
    workspace_created = workspace is None

    if workspace is None:
        workspace = Workspace(
            name=DEFAULT_WORKSPACE_NAME,
            description="Agent Console 的默认协作工作区。",
        )
        session.add(workspace)
        await session.flush()

    existing_names = set(
        await session.scalars(
            select(Agent.name).where(Agent.workspace_id == workspace.id)
        )
    )
    created_agents = 0

    for agent_seed in DEFAULT_AGENTS:
        if agent_seed.name in existing_names:
            continue

        session.add(
            Agent(
                workspace_id=workspace.id,
                name=agent_seed.name,
                role=agent_seed.role,
                description=agent_seed.description,
                avatar=agent_seed.avatar,
                model_name=agent_seed.model_name,
                system_prompt=agent_seed.system_prompt,
                status="idle",
            )
        )
        created_agents += 1

    await session.commit()
    return workspace_created, created_agents


async def run_seed() -> None:
    await init_db()
    try:
        async with AsyncSessionLocal() as session:
            workspace_created, created_agents = await seed_defaults(session)
        print(
            "Seed 完成："
            f"默认工作区{'已创建' if workspace_created else '已存在'}，"
            f"新增 {created_agents} 个 Agent。"
        )
    finally:
        await close_db()


if __name__ == "__main__":
    asyncio.run(run_seed())
