from datetime import datetime, timedelta, timezone
import secrets

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.errors import AppError
from app.api.v1.endpoints.auth import get_current_user_dep
from app.core.permissions import (
    get_current_membership,
    require_workspace_role,
)
from app.db.session import get_db
from app.models.membership import WorkspaceInvitation, WorkspaceMembership
from app.models.user import User
from app.models.workspace import Workspace
from app.schemas.common import SuccessResponse
from app.schemas.membership import (
    InviteCreateRequest,
    InviteResponse,
    JoinWorkspaceRequest,
    MemberRead,
    MyWorkspaceRead,
    UpdateRoleRequest,
    WorkspaceCreateWithMembership,
)

router = APIRouter(prefix="/workspaces", tags=["workspaces"])


@router.get("/my", response_model=SuccessResponse[list[MyWorkspaceRead]])
async def get_my_workspaces(
    user: User = Depends(get_current_user_dep),
    db: AsyncSession = Depends(get_db),
):
    """获取当前用户加入的所有工作区列表。"""
    query = (
        select(Workspace, WorkspaceMembership.role, WorkspaceMembership.joined_at)
        .join(WorkspaceMembership, Workspace.id == WorkspaceMembership.workspace_id)
        .where(WorkspaceMembership.user_id == user.id)
        .order_by(WorkspaceMembership.joined_at.asc())
    )
    results = (await db.execute(query)).all()
    workspaces = [
        MyWorkspaceRead(
            id=ws.id,
            name=ws.name,
            description=ws.description,
            role=role,
            joined_at=joined_at,
        )
        for ws, role, joined_at in results
    ]
    return SuccessResponse(data=workspaces)


@router.post("", response_model=SuccessResponse[MyWorkspaceRead])
async def create_workspace(
    body: WorkspaceCreateWithMembership,
    user: User = Depends(get_current_user_dep),
    db: AsyncSession = Depends(get_db),
):
    """创建新工作区并将当前用户设为 Owner。"""
    workspace = Workspace(name=body.name.strip(), description=body.description.strip())
    db.add(workspace)
    await db.flush()

    membership = WorkspaceMembership(
        user_id=user.id,
        workspace_id=workspace.id,
        role="owner",
    )
    db.add(membership)
    await db.commit()
    await db.refresh(workspace)
    await db.refresh(membership)

    return SuccessResponse(
        data=MyWorkspaceRead(
            id=workspace.id,
            name=workspace.name,
            description=workspace.description,
            role=membership.role,
            joined_at=membership.joined_at,
        )
    )


@router.get("/{workspace_id}/members", response_model=SuccessResponse[list[MemberRead]])
async def list_workspace_members(
    workspace_id: int,
    membership: WorkspaceMembership = Depends(get_current_membership),
    db: AsyncSession = Depends(get_db),
):
    """获取指定工作区的成员列表（需要成员权限）。"""
    query = (
        select(WorkspaceMembership, User)
        .join(User, WorkspaceMembership.user_id == User.id)
        .where(WorkspaceMembership.workspace_id == workspace_id)
        .order_by(WorkspaceMembership.joined_at.asc())
    )
    results = (await db.execute(query)).all()
    members = [
        MemberRead(
            id=m.id,
            user_id=u.id,
            email=u.email,
            display_name=u.display_name,
            avatar=u.avatar,
            role=m.role,
            joined_at=m.joined_at,
        )
        for m, u in results
    ]
    return SuccessResponse(data=members)


@router.post("/{workspace_id}/members/invite", response_model=SuccessResponse[InviteResponse])
async def create_invitation(
    workspace_id: int,
    body: InviteCreateRequest,
    membership: WorkspaceMembership = Depends(require_workspace_role("admin")),
    user: User = Depends(get_current_user_dep),
    db: AsyncSession = Depends(get_db),
):
    """生成工作区邀请码（需要 admin 或 owner 权限）。"""
    if body.role not in {"admin", "member", "viewer"}:
        raise AppError(status_code=400, message="非法的邀请角色")

    invite_code = secrets.token_urlsafe(16)
    expires_at = datetime.now(timezone.utc) + timedelta(days=body.expire_days)

    invitation = WorkspaceInvitation(
        workspace_id=workspace_id,
        inviter_id=user.id,
        invitee_email=body.invitee_email.strip() if body.invitee_email else None,
        invite_code=invite_code,
        role=body.role,
        status="pending",
        expires_at=expires_at,
    )
    db.add(invitation)
    await db.commit()

    return SuccessResponse(
        data=InviteResponse(
            invite_code=invite_code,
            workspace_id=workspace_id,
            role=body.role,
            expires_at=expires_at,
        )
    )


@router.post("/join", response_model=SuccessResponse[MyWorkspaceRead])
async def join_workspace_by_invite(
    body: JoinWorkspaceRequest,
    user: User = Depends(get_current_user_dep),
    db: AsyncSession = Depends(get_db),
):
    """使用邀请码加入工作区。"""
    invitation = await db.scalar(
        select(WorkspaceInvitation).where(
            WorkspaceInvitation.invite_code == body.invite_code.strip()
        )
    )
    if invitation is None:
        raise AppError(status_code=404, message="邀请码不存在或无效")

    if invitation.status != "pending":
        raise AppError(status_code=400, message="该邀请码已被使用或已失效")

    # Timezone-aware expiration check
    now = datetime.now(timezone.utc)
    exp = invitation.expires_at
    if exp.tzinfo is None:
        exp = exp.replace(tzinfo=timezone.utc)
    if now > exp:
        invitation.status = "expired"
        await db.commit()
        raise AppError(status_code=400, message="邀请码已过期")

    # Check existing membership
    existing = await db.scalar(
        select(WorkspaceMembership).where(
            WorkspaceMembership.user_id == user.id,
            WorkspaceMembership.workspace_id == invitation.workspace_id,
        )
    )
    if existing is not None:
        raise AppError(status_code=409, message="您已经是该工作区的成员")

    workspace = await db.get(Workspace, invitation.workspace_id)
    if workspace is None:
        raise AppError(status_code=404, message="工作区不存在")

    membership = WorkspaceMembership(
        user_id=user.id,
        workspace_id=workspace.id,
        role=invitation.role,
    )
    db.add(membership)
    invitation.status = "accepted"
    await db.commit()
    await db.refresh(membership)

    return SuccessResponse(
        data=MyWorkspaceRead(
            id=workspace.id,
            name=workspace.name,
            description=workspace.description,
            role=membership.role,
            joined_at=membership.joined_at,
        )
    )


@router.put("/{workspace_id}/members/{target_user_id}/role", response_model=SuccessResponse[dict])
async def update_member_role(
    workspace_id: int,
    target_user_id: int,
    body: UpdateRoleRequest,
    membership: WorkspaceMembership = Depends(require_workspace_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    """修改成员角色（Admin/Owner 可操作）。"""
    if body.role not in {"owner", "admin", "member", "viewer"}:
        raise AppError(status_code=400, message="非法的目标角色")

    # Only owner can promote/demote to/from owner
    if (body.role == "owner" or membership.role != "owner") and membership.role != "owner":
        raise AppError(status_code=403, message="仅工作区所有者可指定新的所有者")

    target_membership = await db.scalar(
        select(WorkspaceMembership).where(
            WorkspaceMembership.workspace_id == workspace_id,
            WorkspaceMembership.user_id == target_user_id,
        )
    )
    if target_membership is None:
        raise AppError(status_code=404, message="目标成员不存在于该工作区")

    target_membership.role = body.role
    await db.commit()
    return SuccessResponse(data={"message": "成员角色更新成功", "role": body.role})


@router.delete("/{workspace_id}/members/{target_user_id}", response_model=SuccessResponse[dict])
async def remove_member(
    workspace_id: int,
    target_user_id: int,
    membership: WorkspaceMembership = Depends(require_workspace_role("admin")),
    user: User = Depends(get_current_user_dep),
    db: AsyncSession = Depends(get_db),
):
    """移除工作区成员。"""
    if target_user_id == user.id:
        raise AppError(status_code=400, message="无法通过此接口移除自己")

    target_membership = await db.scalar(
        select(WorkspaceMembership).where(
            WorkspaceMembership.workspace_id == workspace_id,
            WorkspaceMembership.user_id == target_user_id,
        )
    )
    if target_membership is None:
        raise AppError(status_code=404, message="目标成员不存在于该工作区")

    if target_membership.role == "owner":
        raise AppError(status_code=403, message="无法移除工作区所有者")

    await db.delete(target_membership)
    await db.commit()
    return SuccessResponse(data={"message": "成员已成功移除"})
