from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.permissions import require_workspace_role
from app.db.session import get_db
from app.models.membership import WorkspaceMembership
from app.schemas.common import SuccessResponse
from app.schemas.quota import (
    QuotaConfigRead,
    QuotaConfigUpdate,
    QuotaUsageRead,
)
from app.services.audit_service import record_audit_log
from app.services.quota_service import (
    get_workspace_quota_usage,
    update_quota_config,
)

router = APIRouter(prefix="/workspaces/{workspace_id}/quota", tags=["quota"])


@router.get("", response_model=SuccessResponse[QuotaUsageRead])
async def get_quota_status(
    workspace_id: int,
    membership: WorkspaceMembership = Depends(require_workspace_role("viewer")),
    db: AsyncSession = Depends(get_db),
):
    """获取工作区配额配置与当月使用水位。"""
    usage = await get_workspace_quota_usage(db, workspace_id)
    return SuccessResponse(data=usage)


@router.put("", response_model=SuccessResponse[QuotaConfigRead])
async def set_quota_config(
    workspace_id: int,
    body: QuotaConfigUpdate,
    membership: WorkspaceMembership = Depends(require_workspace_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    """更新工作区配额配置（需 Admin 权限）。"""
    updated = await update_quota_config(db, workspace_id, body)

    # 记录审计日志
    await record_audit_log(
        db,
        workspace_id=workspace_id,
        user_id=membership.user_id,
        action="quota.update",
        resource_type="quota_config",
        resource_id=str(updated.id),
        detail=body.model_dump(exclude_unset=True),
    )

    return SuccessResponse(data=QuotaConfigRead.model_validate(updated))
