from fastapi import APIRouter, Depends, Query, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.errors import AppError
from app.api.persistence import commit_or_conflict
from app.api.rbac_compat import enforce_workspace_role
from app.db.session import get_db
from app.models import Agent, Workspace
from app.schemas import (
    AgentCreate,
    AgentRead,
    AgentStatusRead,
    AgentUpdate,
    SuccessResponse,
)
from app.websocket import create_event, websocket_manager

router = APIRouter(prefix="/agents", tags=["agents"])


@router.get("", response_model=SuccessResponse[list[AgentRead]])
async def list_agents(
    request: Request,
    workspace_id: int | None = Query(default=None, gt=0),
    agent_status: str | None = Query(default=None, alias="status"),
    session: AsyncSession = Depends(get_db),
) -> SuccessResponse[list[AgentRead]]:
    await enforce_workspace_role(
        request, session, workspace_id=workspace_id, min_role="viewer"
    )
    statement = select(Agent)
    if workspace_id is not None:
        statement = statement.where(Agent.workspace_id == workspace_id)
    if agent_status is not None:
        statement = statement.where(Agent.status == agent_status)
    agents = (await session.scalars(statement.order_by(Agent.id))).all()
    return SuccessResponse(data=list(agents))


@router.post(
    "", response_model=SuccessResponse[AgentRead], status_code=status.HTTP_201_CREATED
)
async def create_agent(
    request: Request,
    payload: AgentCreate,
    session: AsyncSession = Depends(get_db),
) -> SuccessResponse[AgentRead]:
    await enforce_workspace_role(
        request, session, workspace_id=payload.workspace_id, min_role="admin"
    )
    if await session.get(Workspace, payload.workspace_id) is None:
        raise AppError(404, "Workspace not found")
    agent = Agent(**payload.model_dump())
    session.add(agent)
    await commit_or_conflict(
        session, "An agent with this name already exists in the workspace"
    )
    await session.refresh(agent)
    return SuccessResponse(data=agent)


@router.get("/{agent_id}", response_model=SuccessResponse[AgentRead])
async def get_agent(
    agent_id: int,
    request: Request,
    session: AsyncSession = Depends(get_db),
) -> SuccessResponse[AgentRead]:
    agent = await session.get(Agent, agent_id)
    if agent is None:
        raise AppError(404, "Agent not found")
    await enforce_workspace_role(
        request, session, workspace_id=agent.workspace_id, min_role="viewer"
    )
    return SuccessResponse(data=agent)


@router.patch("/{agent_id}", response_model=SuccessResponse[AgentRead])
async def update_agent(
    agent_id: int,
    request: Request,
    payload: AgentUpdate,
    session: AsyncSession = Depends(get_db),
) -> SuccessResponse[AgentRead]:
    agent = await session.get(Agent, agent_id)
    if agent is None:
        raise AppError(404, "Agent not found")
    await enforce_workspace_role(
        request, session, workspace_id=agent.workspace_id, min_role="admin"
    )
    updates = payload.model_dump(exclude_unset=True)
    previous_status = agent.status
    for field, value in updates.items():
        setattr(agent, field, value)
    await commit_or_conflict(
        session, "An agent with this name already exists in the workspace"
    )
    await session.refresh(agent)
    if "status" in updates and agent.status != previous_status:
        status_data = AgentStatusRead(
            id=agent.id,
            status=agent.status,
            last_active_at=agent.last_active_at,
        )
        await websocket_manager.broadcast_to_workspace(
            agent.workspace_id,
            create_event("agent.status_changed", status_data),
        )
    return SuccessResponse(data=agent)


@router.get(
    "/{agent_id}/status", response_model=SuccessResponse[AgentStatusRead]
)
async def get_agent_status(
    agent_id: int,
    request: Request,
    session: AsyncSession = Depends(get_db),
) -> SuccessResponse[AgentStatusRead]:
    agent = await session.get(Agent, agent_id)
    if agent is None:
        raise AppError(404, "Agent not found")
    await enforce_workspace_role(
        request, session, workspace_id=agent.workspace_id, min_role="viewer"
    )
    return SuccessResponse(
        data=AgentStatusRead(
            id=agent.id,
            status=agent.status,
            last_active_at=agent.last_active_at,
        )
    )
