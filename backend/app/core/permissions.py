from collections.abc import Callable
from typing import Literal

from fastapi import Depends, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.errors import AppError
from app.api.v1.endpoints.auth import get_current_user_dep
from app.db.session import get_db
from app.models.membership import WorkspaceMembership
from app.models.user import User

RoleType = Literal["owner", "admin", "member", "viewer"]

ROLE_HIERARCHY: dict[str, int] = {
    "owner": 100,
    "admin": 80,
    "member": 50,
    "viewer": 10,
}

# Resource -> Action -> Min required role
PERMISSION_MATRIX: dict[str, dict[str, str]] = {
    "workspace": {
        "delete": "owner",
        "update": "admin",
        "read": "viewer",
    },
    "member": {
        "invite": "admin",
        "manage_roles": "admin",
        "remove": "admin",
        "read": "viewer",
    },
    "agent": {
        "create": "admin",
        "update": "admin",
        "delete": "admin",
        "read": "viewer",
    },
    "task": {
        "create": "member",
        "cancel": "member",
        "retry": "member",
        "read": "viewer",
    },
    "settings": {
        "manage_keys": "admin",
        "manage_models": "admin",
        "read": "viewer",
    },
    "audit": {
        "read": "admin",
    },
    "quota": {
        "manage": "owner",
        "read": "admin",
    },
}


def has_permission(user_role: str, resource: str, action: str) -> bool:
    required_role = PERMISSION_MATRIX.get(resource, {}).get(action, "owner")
    user_level = ROLE_HIERARCHY.get(user_role, 0)
    required_level = ROLE_HIERARCHY.get(required_role, 100)
    return user_level >= required_level


async def get_current_membership(
    workspace_id: int,
    user: User = Depends(get_current_user_dep),
    db: AsyncSession = Depends(get_db),
) -> WorkspaceMembership:
    membership = await db.scalar(
        select(WorkspaceMembership).where(
            WorkspaceMembership.user_id == user.id,
            WorkspaceMembership.workspace_id == workspace_id,
        )
    )
    if membership is None:
        raise AppError(status_code=403, message="您不是该工作区的成员")
    return membership


def require_workspace_role(min_role: str) -> Callable:
    async def dependency(
        membership: WorkspaceMembership = Depends(get_current_membership),
    ) -> WorkspaceMembership:
        user_level = ROLE_HIERARCHY.get(membership.role, 0)
        required_level = ROLE_HIERARCHY.get(min_role, 100)
        if user_level < required_level:
            raise AppError(status_code=403, message=f"权限不足：需要 {min_role} 或更高权限")
        return membership

    return dependency


def require_workspace_permission(resource: str, action: str) -> Callable:
    async def dependency(
        membership: WorkspaceMembership = Depends(get_current_membership),
    ) -> WorkspaceMembership:
        if not has_permission(membership.role, resource, action):
            raise AppError(status_code=403, message=f"权限不足：无法执行 {resource}.{action}")
        return membership

    return dependency
