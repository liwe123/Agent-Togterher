from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.errors import AppError
from app.core.auth import (
    authenticate_user,
    create_access_token,
    create_refresh_token,
    get_user_by_email,
    get_user_by_id,
    get_user_id_from_token,
    hash_password,
)
from app.db.session import get_db
from app.models.user import User
from app.schemas.auth import (
    AuthResponse,
    LoginRequest,
    RefreshRequest,
    RegisterRequest,
    TokenRefreshResponse,
    UserRead,
)
from app.schemas.common import SuccessResponse

router = APIRouter(prefix="/auth", tags=["auth"])

async def get_current_user_dep(request: Request, db: AsyncSession = Depends(get_db)) -> User:
    """FastAPI dependency to extract and validate the current user from JWT."""
    from app.core.security import _bearer_token
    token = _bearer_token(request.headers.get("authorization"))
    if token is None:
        raise AppError(status_code=401, message="未提供认证凭据")
    user_id = get_user_id_from_token(token, expected_type="access")
    if user_id is None:
        raise AppError(status_code=401, message="token 无效或已过期")
    user = await get_user_by_id(db, user_id)
    if user is None or not user.is_active:
        raise AppError(status_code=401, message="用户不存在或已被禁用")
    return user


@router.post("/register", response_model=SuccessResponse[AuthResponse])
async def register(body: RegisterRequest, db: AsyncSession = Depends(get_db)):
    """注册新用户。"""
    existing = await get_user_by_email(db, body.email.lower().strip())
    if existing is not None:
        raise AppError(status_code=409, message="该邮箱已被注册")

    user = User(
        email=body.email.lower().strip(),
        password_hash=hash_password(body.password),
        display_name=body.display_name.strip(),
    )
    db.add(user)
    await db.flush()

    # Automatically assign to workspace
    from app.models.membership import WorkspaceMembership
    from app.models.workspace import Workspace
    from sqlalchemy import select, func

    first_workspace = await db.scalar(select(Workspace).order_by(Workspace.id.asc()).limit(1))
    if first_workspace is None:
        first_workspace = Workspace(name=f"{user.display_name}的工作区", description="默认个人协作空间")
        db.add(first_workspace)
        await db.flush()
        db.add(WorkspaceMembership(user_id=user.id, workspace_id=first_workspace.id, role="owner"))
    else:
        member_count = await db.scalar(
            select(func.count()).select_from(WorkspaceMembership).where(WorkspaceMembership.workspace_id == first_workspace.id)
        )
        role = "owner" if (member_count or 0) == 0 else "member"
        db.add(WorkspaceMembership(user_id=user.id, workspace_id=first_workspace.id, role=role))

    await db.commit()
    await db.refresh(user)

    access_token = create_access_token(user.id)
    refresh_token = create_refresh_token(user.id)

    return SuccessResponse(
        data=AuthResponse(
            user=UserRead.model_validate(user),
            access_token=access_token,
            refresh_token=refresh_token,
        )
    )


@router.post("/login", response_model=SuccessResponse[AuthResponse])
async def login(body: LoginRequest, db: AsyncSession = Depends(get_db)):
    """用户登录。"""
    user = await authenticate_user(db, body.email.lower().strip(), body.password)
    if user is None:
        raise AppError(status_code=401, message="邮箱或密码错误")

    # Update last login time
    user.last_login_at = datetime.now(timezone.utc)
    await db.commit()

    access_token = create_access_token(user.id)
    refresh_token = create_refresh_token(user.id)

    return SuccessResponse(
        data=AuthResponse(
            user=UserRead.model_validate(user),
            access_token=access_token,
            refresh_token=refresh_token,
        )
    )


@router.post("/refresh", response_model=SuccessResponse[TokenRefreshResponse])
async def refresh_token(body: RefreshRequest, db: AsyncSession = Depends(get_db)):
    """刷新 access_token。"""
    user_id = get_user_id_from_token(body.refresh_token, expected_type="refresh")
    if user_id is None:
        raise AppError(status_code=401, message="refresh_token 无效或已过期")

    user = await get_user_by_id(db, user_id)
    if user is None or not user.is_active:
        raise AppError(status_code=401, message="用户不存在或已被禁用")

    new_access_token = create_access_token(user.id)
    return SuccessResponse(
        data=TokenRefreshResponse(access_token=new_access_token)
    )


@router.post("/logout", response_model=SuccessResponse[dict])
async def logout():
    """用户登出（前端清除 token 即可）。"""
    return SuccessResponse(data={"message": "已登出"})


@router.get("/me", response_model=SuccessResponse[UserRead])
async def get_current_user_info(
    user: User = Depends(get_current_user_dep)
):
    """获取当前登录用户信息。"""
    return SuccessResponse(data=UserRead.model_validate(user))
