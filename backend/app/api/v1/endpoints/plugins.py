import json
from typing import Any
from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.errors import AppError
from app.core.permissions import require_workspace_role
from app.db.session import get_db
from app.models.membership import WorkspaceMembership
from app.models.plugin import Plugin, WorkspacePlugin
from app.models.workspace import Workspace
from app.schemas.common import SuccessResponse
from app.schemas.plugin import (
    PluginCreate,
    PluginResponse,
    WorkspacePluginResponse,
    WorkspacePluginToggle,
)
from app.services.audit_service import record_audit_log

router = APIRouter(tags=["plugins"])


@router.get("/plugins", response_model=SuccessResponse[list[PluginResponse]])
async def list_plugins(
    workspace_id: int | None = Query(None, description="工作区 ID，用于计算安装与启用状态"),
    db: AsyncSession = Depends(get_db),
):
    """获取所有可用插件列表。如果提供 workspace_id，则返回该工作区的挂载状态。"""
    query = select(Plugin).where(Plugin.is_public.is_(True)).order_by(Plugin.id.asc())
    plugins = (await db.scalars(query)).all()

    installed_map: dict[int, WorkspacePlugin] = {}
    if workspace_id:
        ws_plugins = (
            await db.scalars(
                select(WorkspacePlugin).where(WorkspacePlugin.workspace_id == workspace_id)
            )
        ).all()
        installed_map = {wp.plugin_id: wp for wp in ws_plugins}

    result: list[PluginResponse] = []
    for p in plugins:
        manifest: dict[str, Any] = {}
        try:
            manifest = json.loads(p.manifest_json)
        except Exception:
            manifest = {"name": p.name}

        tools_count = len(manifest.get("tools", []))
        wp = installed_map.get(p.id)

        result.append(
            PluginResponse(
                id=p.id,
                name=p.name,
                display_name=p.display_name,
                description=p.description,
                version=p.version,
                icon=p.icon,
                author=p.author,
                manifest=manifest,
                is_public=p.is_public,
                is_installed=wp is not None,
                is_enabled=wp.is_enabled if wp else False,
                tools_count=tools_count,
                created_at=p.created_at,
                updated_at=p.updated_at,
            )
        )

    return SuccessResponse(data=result)


@router.post("/plugins", response_model=SuccessResponse[PluginResponse])
async def register_plugin(
    payload: PluginCreate,
    db: AsyncSession = Depends(get_db),
):
    """注册新的全局或私有插件。"""
    existing = await db.scalar(select(Plugin).where(Plugin.name == payload.name))
    if existing:
        raise AppError(status_code=409, message=f"插件 '{payload.name}' 已存在")

    try:
        manifest_data = json.loads(payload.manifest_json)
    except Exception as exc:
        raise AppError(status_code=422, message=f"Manifest JSON 格式错误: {exc}") from exc

    plugin = Plugin(
        name=payload.name,
        display_name=payload.display_name,
        description=payload.description,
        version=payload.version,
        icon=payload.icon,
        author=payload.author,
        manifest_json=payload.manifest_json,
        is_public=payload.is_public,
    )
    db.add(plugin)
    await db.commit()
    await db.refresh(plugin)

    return SuccessResponse(
        data=PluginResponse(
            id=plugin.id,
            name=plugin.name,
            display_name=plugin.display_name,
            description=plugin.description,
            version=plugin.version,
            icon=plugin.icon,
            author=plugin.author,
            manifest=manifest_data,
            is_public=plugin.is_public,
            is_installed=False,
            is_enabled=False,
            tools_count=len(manifest_data.get("tools", [])),
            created_at=plugin.created_at,
            updated_at=plugin.updated_at,
        )
    )


@router.post(
    "/workspaces/{workspace_id}/plugins/{plugin_id}/toggle",
    response_model=SuccessResponse[WorkspacePluginResponse],
)
async def toggle_workspace_plugin(
    workspace_id: int,
    plugin_id: int,
    payload: WorkspacePluginToggle,
    membership: WorkspaceMembership = Depends(require_workspace_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    """在指定工作区挂载、启用或停用插件（仅 Admin 及以上角色）。"""
    plugin = await db.get(Plugin, plugin_id)
    if plugin is None:
        raise AppError(status_code=404, message="插件不存在")

    wp = await db.scalar(
        select(WorkspacePlugin).where(
            WorkspacePlugin.workspace_id == workspace_id,
            WorkspacePlugin.plugin_id == plugin_id,
        )
    )

    config_str = json.dumps(payload.config) if payload.config else None

    if wp is None:
        wp = WorkspacePlugin(
            workspace_id=workspace_id,
            plugin_id=plugin_id,
            is_enabled=payload.is_enabled,
            config_json=config_str,
        )
        db.add(wp)
    else:
        wp.is_enabled = payload.is_enabled
        if payload.config is not None:
            wp.config_json = config_str

    await db.commit()
    await db.refresh(wp)

    await record_audit_log(
        db,
        workspace_id=workspace_id,
        user_id=membership.user_id,
        action="plugin.toggle",
        resource_type="plugin",
        resource_id=str(plugin_id),
        detail={
            "plugin_name": plugin.name,
            "is_enabled": payload.is_enabled,
        },
    )

    parsed_config = None
    if wp.config_json:
        try:
            parsed_config = json.loads(wp.config_json)
        except Exception:
            pass

    return SuccessResponse(
        data=WorkspacePluginResponse(
            workspace_id=workspace_id,
            plugin_id=plugin_id,
            is_enabled=wp.is_enabled,
            config=parsed_config,
            updated_at=wp.updated_at,
        )
    )


@router.get(
    "/workspaces/{workspace_id}/plugins/active-tools",
    response_model=SuccessResponse[list[dict[str, Any]]],
)
async def get_workspace_active_plugin_tools(
    workspace_id: int,
    db: AsyncSession = Depends(get_db),
):
    """获取指定工作区当前已启用的所有插件自定义工具声明列表。"""
    query = (
        select(WorkspacePlugin, Plugin)
        .join(Plugin, WorkspacePlugin.plugin_id == Plugin.id)
        .where(
            WorkspacePlugin.workspace_id == workspace_id,
            WorkspacePlugin.is_enabled.is_(True),
        )
    )
    rows = (await db.execute(query)).all()

    active_tools: list[dict[str, Any]] = []
    for wp, plugin in rows:
        try:
            manifest = json.loads(plugin.manifest_json)
            for tool in manifest.get("tools", []):
                tool_copy = dict(tool)
                tool_copy["plugin_name"] = plugin.name
                active_tools.append(tool_copy)
        except Exception:
            continue

    return SuccessResponse(data=active_tools)
