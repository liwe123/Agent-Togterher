from datetime import datetime

from pydantic import BaseModel, Field


class MemberRead(BaseModel):
    id: int
    user_id: int
    email: str
    display_name: str
    avatar: str | None = None
    role: str
    joined_at: datetime

    model_config = {"from_attributes": True}


class InviteCreateRequest(BaseModel):
    role: str = Field(default="member", description="邀请角色: admin / member / viewer")
    invitee_email: str | None = Field(default=None, description="被邀请人邮箱（可选）")
    expire_days: int = Field(default=7, ge=1, le=30, description="有效天数")


class InviteResponse(BaseModel):
    invite_code: str
    workspace_id: int
    role: str
    expires_at: datetime


class JoinWorkspaceRequest(BaseModel):
    invite_code: str = Field(..., description="工作区邀请码")


class UpdateRoleRequest(BaseModel):
    role: str = Field(..., description="新角色: admin / member / viewer")


class MyWorkspaceRead(BaseModel):
    id: int
    name: str
    description: str
    role: str
    joined_at: datetime

    model_config = {"from_attributes": True}


class WorkspaceCreateWithMembership(BaseModel):
    name: str = Field(..., max_length=100, description="工作区名称")
    description: str = Field(default="", description="工作区描述")
