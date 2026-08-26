"""Backward-compatible RBAC guards for the legacy ``/api`` surface.

``app.api.rest_router`` re-exports the pre-RBAC endpoint modules (tasks,
agents, custom models, provider keys) under ``/api``. Those routes were
historically protected only by the optional global ``APP_API_TOKEN``
middleware in ``app.main``, and existing clients (including the dev
frontend) may call them with a static token or without any credentials.

To close the authorisation gap without breaking that contract, the guards
below enforce workspace RBAC only when the request carries a *valid user
JWT access token* -- the same credential class the v1 API relies on via
``app.core.permissions``. Static-token and open-mode requests keep their
legacy behaviour.
"""

from __future__ import annotations

from fastapi import Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.errors import AppError
from app.core.auth import get_user_by_id, get_user_id_from_token
from app.core.permissions import ROLE_HIERARCHY
from app.core.security import _bearer_token
from app.models.membership import WorkspaceMembership
from app.models.user import User


async def _jwt_user(request: Request, session: AsyncSession) -> User | None:
    """Resolve the caller from a Bearer JWT, or ``None`` for legacy callers."""
    token = _bearer_token(request.headers.get("authorization"))
    if token is None:
        return None
    user_id = get_user_id_from_token(token, expected_type="access")
    if user_id is None:
        return None
    user = await get_user_by_id(session, user_id)
    if user is None or not user.is_active:
        return None
    return user


def _require_level(role: str, min_role: str) -> None:
    if ROLE_HIERARCHY.get(role, 0) < ROLE_HIERARCHY.get(min_role, 100):
        raise AppError(status_code=403, message=f"权限不足：需要 {min_role} 或更高权限")


async def enforce_workspace_role(
    request: Request,
    session: AsyncSession,
    *,
    workspace_id: int | None,
    min_role: str,
) -> WorkspaceMembership | None:
    """Require ``min_role`` in ``workspace_id`` from JWT callers.

    Legacy (non-JWT) callers pass through untouched; JWT callers that are
    not members of the workspace are rejected with 403. Returns the resolved
    membership, or ``None`` when enforcement was skipped.
    """
    user = await _jwt_user(request, session)
    if user is None or workspace_id is None:
        return None
    membership = await session.scalar(
        select(WorkspaceMembership).where(
            WorkspaceMembership.user_id == user.id,
            WorkspaceMembership.workspace_id == workspace_id,
        )
    )
    if membership is None:
        raise AppError(status_code=403, message="您不是该工作区的成员")
    _require_level(membership.role, min_role)
    return membership


async def enforce_global_role(
    request: Request,
    session: AsyncSession,
    *,
    min_role: str,
) -> WorkspaceMembership | None:
    """Guard tenant-wide resources (provider keys / custom models).

    JWT callers must hold ``min_role`` (or higher) in at least one workspace;
    legacy callers pass through untouched.
    """
    user = await _jwt_user(request, session)
    if user is None:
        return None
    memberships = (
        await session.scalars(
            select(WorkspaceMembership).where(WorkspaceMembership.user_id == user.id)
        )
    ).all()
    best_level = max((ROLE_HIERARCHY.get(m.role, 0) for m in memberships), default=0)
    if best_level < ROLE_HIERARCHY.get(min_role, 100):
        raise AppError(status_code=403, message=f"权限不足：需要 {min_role} 或更高权限")
    return memberships[0] if memberships else None
