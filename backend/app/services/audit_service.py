import json
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.audit_log import AuditLog


async def record_audit_log(
    db: AsyncSession,
    *,
    workspace_id: int | None = None,
    user_id: int | None = None,
    action: str,
    resource_type: str,
    resource_id: str | None = None,
    detail: dict[str, Any] | None = None,
    ip_address: str | None = None,
) -> AuditLog:
    """写入一条平台操作审计日志。"""
    detail_str = json.dumps(detail, ensure_ascii=False) if detail is not None else None

    log_entry = AuditLog(
        workspace_id=workspace_id,
        user_id=user_id,
        action=action,
        resource_type=resource_type,
        resource_id=str(resource_id) if resource_id is not None else None,
        detail=detail_str,
        ip_address=ip_address,
    )
    db.add(log_entry)
    await db.commit()
    await db.refresh(log_entry)
    return log_entry
