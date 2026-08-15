from datetime import datetime
from typing import Any

from pydantic import BaseModel


class AuditLogRead(BaseModel):
    id: int
    workspace_id: int | None = None
    user_id: int | None = None
    user_display_name: str | None = None
    action: str
    resource_type: str
    resource_id: str | None = None
    detail: dict[str, Any] | None = None
    ip_address: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class AuditLogListResponse(BaseModel):
    items: list[AuditLogRead]
    total: int
    offset: int
    limit: int
