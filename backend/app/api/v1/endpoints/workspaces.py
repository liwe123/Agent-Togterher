from fastapi import APIRouter, Depends, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.errors import AppError
from app.api.persistence import commit_or_conflict
from app.db.session import get_db
from app.models import Workspace
from app.schemas import SuccessResponse, WorkspaceCreate, WorkspaceRead

router = APIRouter(prefix="/workspaces", tags=["workspaces"])


@router.get("", response_model=SuccessResponse[list[WorkspaceRead]])
async def list_workspaces(
    session: AsyncSession = Depends(get_db),
) -> SuccessResponse[list[WorkspaceRead]]:
    workspaces = (await session.scalars(select(Workspace).order_by(Workspace.id))).all()
    return SuccessResponse(data=list(workspaces))


@router.post(
    "", response_model=SuccessResponse[WorkspaceRead], status_code=status.HTTP_201_CREATED
)
async def create_workspace(
    payload: WorkspaceCreate,
    session: AsyncSession = Depends(get_db),
) -> SuccessResponse[WorkspaceRead]:
    workspace = Workspace(**payload.model_dump())
    session.add(workspace)
    await commit_or_conflict(session, "A workspace with this name already exists")
    await session.refresh(workspace)
    return SuccessResponse(data=workspace)


@router.get("/{workspace_id}", response_model=SuccessResponse[WorkspaceRead])
async def get_workspace(
    workspace_id: int,
    session: AsyncSession = Depends(get_db),
) -> SuccessResponse[WorkspaceRead]:
    workspace = await session.get(Workspace, workspace_id)
    if workspace is None:
        raise AppError(404, "Workspace not found")
    return SuccessResponse(data=workspace)
