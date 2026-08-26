from datetime import datetime

from pydantic import BaseModel, EmailStr, Field


class RegisterRequest(BaseModel):
    email: str = Field(..., max_length=255, description="邮箱地址")
    password: str = Field(..., min_length=6, max_length=128, description="密码")
    display_name: str = Field(..., min_length=1, max_length=100, description="显示名称")


class LoginRequest(BaseModel):
    email: str = Field(..., max_length=255)
    password: str = Field(..., max_length=128)


class RefreshRequest(BaseModel):
    refresh_token: str


class LogoutRequest(BaseModel):
    refresh_token: str | None = None


class UserRead(BaseModel):
    id: int
    email: str
    display_name: str
    avatar: str | None = None
    is_active: bool = True
    created_at: datetime
    last_login_at: datetime | None = None

    model_config = {"from_attributes": True}


class AuthTokens(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class AuthResponse(BaseModel):
    user: UserRead
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class TokenRefreshResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
