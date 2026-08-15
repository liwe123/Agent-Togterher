import json
from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.permissions import require_workspace_role
from app.db.session import get_db
from app.models.audit_log import AuditLog
from app.models.membership import WorkspaceMembership
from app.models.user import User
from app.schemas.audit import AuditLogListResponse, AuditLogRead
from app.schemas.common import SuccessResponse

router = APIRouter(prefix="/workspaces/{workspace_id}/audit-logs", tags=["audit-logs"])


@router.get("", response_model=SuccessResponse[AuditLogListResponse])
async def list_workspace_audit_logs(
    workspace_id: int,
    action: str | None = Query(default=None, description="按动作类型过滤"),
    resource_type: str | None = Query(default=None, description="按资源类型过滤"),
    user_id: int | None = Query(default=None, description="按操作人过滤"),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=100),
    membership: WorkspaceMembership = Depends(require_workspace_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    """获取工作区审计日志列表（需要 Admin 权限）。"""
    base_query = select(AuditLog, User.display_name).outerjoin(User, AuditLog.user_id == User.id)

    # Filter by workspace or platform-level logs
    base_query = base_query.where(
        (AuditLog.workspace_id == workspace_id) | (AuditLog.workspace_id.is_(None))
    )

    if action:
        base_query = base_query.where(AuditLog.action == action)
    if resource_type:
        base_query = base_query.where(AuditLog.resource_type == resource_type)
    if user_id:
        base_query = base_query.where(AuditLog.user_id == user_id)

    # Count total
    count_query = select(func.count()).select_from(base_query.subquery())
    total = (await db.scalar(count_query)) or 0

    # Fetch paginated items
    items_query = base_query.order_by(AuditLog.created_at.desc()).offset(offset).limit(limit)
    rows = (await db.execute(items_query)).all()

    items: list[AuditLogRead] = []
    for log, display_name in rows:
        detail_dict = None
        if log.detail:
            try:
                detail_dict = json.loads(log.detail)
            except Exception:
                detail_dict = {"raw": log.detail}

        items.append(
            AuditLogRead(
                id=log.id,
                workspace_id=log.workspace_id,
                user_id=log.user_id,
                user_display_name=display_name,
                action=log.action,
                resource_type=log.resource_type,
                resource_id=log.resource_id,
                detail=detail_dict,
                ip_address=log.ip_address,
                created_at=log.created_at,
            )
        )

    return SuccessResponse(
        data=AuditLogListResponse(
            items=items,
            total=total,
            offset=offset,
            limit=limit,
        )
    )
