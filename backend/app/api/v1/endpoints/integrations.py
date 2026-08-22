import json

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.errors import AppError
from app.api.persistence import commit_or_conflict
from app.db.base import utc_now
from app.db.session import get_db
from app.models.integration_node import IntegrationNode
from app.models.task import Task
from app.models.workspace import Workspace
from app.schemas import (
    IntegrationDispatchRequest,
    IntegrationDispatchResponse,
    IntegrationHeartbeat,
    IntegrationNodeCreate,
    IntegrationNodeRead,
    IntegrationNodeUpdate,
    SuccessResponse,
)
from app.services.audit_service import record_audit_log
from app.services.integration_service import (
    DispatchPackage,
    build_bridge,
)
from app.core.message_hub import schedule_node_dispatch
from app.websocket import create_event, websocket_manager

router = APIRouter(prefix="/integrations", tags=["integrations"])


def _parse_capabilities(raw: str | None) -> list[str]:
    if not raw:
        return []
    try:
        data = json.loads(raw)
        return data if isinstance(data, list) else []
    except Exception:
        return []


def _serialize(node: IntegrationNode) -> IntegrationNodeRead:
    return IntegrationNodeRead(
        id=node.id,
        workspace_id=node.workspace_id,
        name=node.name,
        provider=node.provider,
        mode=node.mode,
        status=node.status,
        version=node.version,
        capabilities=_parse_capabilities(node.capabilities_json),
        endpoint=node.endpoint,
        current_task_count=node.current_task_count,
        max_concurrency=node.max_concurrency,
        last_heartbeat_at=node.last_heartbeat_at,
        created_at=node.created_at,
        updated_at=node.updated_at,
    )


@router.get("/nodes", response_model=SuccessResponse[list[IntegrationNodeRead]])
async def list_nodes(
    workspace_id: int | None = Query(default=None, gt=0),
    node_status: str | None = Query(default=None, alias="status"),
    session: AsyncSession = Depends(get_db),
) -> SuccessResponse[list[IntegrationNodeRead]]:
    statement = select(IntegrationNode)
    if workspace_id is not None:
        statement = statement.where(IntegrationNode.workspace_id == workspace_id)
    if node_status is not None:
        statement = statement.where(IntegrationNode.status == node_status)
    nodes = (await session.scalars(statement.order_by(IntegrationNode.id))).all()
    return SuccessResponse(data=[_serialize(n) for n in nodes])


@router.post(
    "/nodes",
    response_model=SuccessResponse[IntegrationNodeRead],
    status_code=status.HTTP_201_CREATED,
)
async def register_node(
    payload: IntegrationNodeCreate,
    session: AsyncSession = Depends(get_db),
) -> SuccessResponse[IntegrationNodeRead]:
    if await session.get(Workspace, payload.workspace_id) is None:
        raise AppError(404, "Workspace not found")
    node = IntegrationNode(
        workspace_id=payload.workspace_id,
        name=payload.name,
        provider=payload.provider,
        mode=payload.mode,
        status=payload.status,
        version=payload.version,
        capabilities_json=json.dumps(payload.capabilities) if payload.capabilities else None,
        endpoint=payload.endpoint,
        config_json=json.dumps(payload.config) if payload.config else None,
        max_concurrency=payload.max_concurrency,
    )
    session.add(node)
    await commit_or_conflict(
        session, "A node with this name already exists in the workspace"
    )
    await session.refresh(node)
    await record_audit_log(
        session,
        workspace_id=node.workspace_id,
        action="integration_node.register",
        resource_type="integration_node",
        resource_id=str(node.id),
        detail={"provider": node.provider, "mode": node.mode, "name": node.name},
    )
    return SuccessResponse(data=_serialize(node))


@router.get("/nodes/{node_id}", response_model=SuccessResponse[IntegrationNodeRead])
async def get_node(
    node_id: int,
    session: AsyncSession = Depends(get_db),
) -> SuccessResponse[IntegrationNodeRead]:
    node = await session.get(IntegrationNode, node_id)
    if node is None:
        raise AppError(404, "Integration node not found")
    return SuccessResponse(data=_serialize(node))


@router.patch("/nodes/{node_id}", response_model=SuccessResponse[IntegrationNodeRead])
async def update_node(
    node_id: int,
    payload: IntegrationNodeUpdate,
    session: AsyncSession = Depends(get_db),
) -> SuccessResponse[IntegrationNodeRead]:
    node = await session.get(IntegrationNode, node_id)
    if node is None:
        raise AppError(404, "Integration node not found")
    updates = payload.model_dump(exclude_unset=True)
    capabilities = updates.pop("capabilities", None)
    config = updates.pop("config", None)
    for field, value in updates.items():
        setattr(node, field, value)
    if capabilities is not None:
        node.capabilities_json = json.dumps(capabilities) if capabilities else None
    if config is not None:
        node.config_json = json.dumps(config) if config else None
    await commit_or_conflict(
        session, "A node with this name already exists in the workspace"
    )
    await session.refresh(node)

    await websocket_manager.broadcast_to_workspace(
        node.workspace_id,
        create_event("integration.status_changed", _serialize(node)),
    )
    return SuccessResponse(data=_serialize(node))


@router.post(
    "/nodes/{node_id}/heartbeat",
    response_model=SuccessResponse[IntegrationNodeRead],
)
async def heartbeat(
    node_id: int,
    payload: IntegrationHeartbeat,
    session: AsyncSession = Depends(get_db),
) -> SuccessResponse[IntegrationNodeRead]:
    node = await session.get(IntegrationNode, node_id)
    if node is None:
        raise AppError(404, "Integration node not found")
    node.status = payload.status
    node.last_heartbeat_at = utc_now()
    if payload.version is not None:
        node.version = payload.version
    if payload.capabilities:
        node.capabilities_json = json.dumps(payload.capabilities)
    if payload.current_task_count is not None:
        node.current_task_count = payload.current_task_count
    await session.commit()
    await session.refresh(node)

    await record_audit_log(
        session,
        workspace_id=node.workspace_id,
        action="integration_node.heartbeat",
        resource_type="integration_node",
        resource_id=str(node.id),
        detail={
            "status": node.status,
            "current_task_count": node.current_task_count,
            "version": node.version,
        },
    )
    await websocket_manager.broadcast_to_workspace(
        node.workspace_id,
        create_event("integration.heartbeat", _serialize(node)),
    )
    return SuccessResponse(data=_serialize(node))


@router.post(
    "/dispatch",
    response_model=SuccessResponse[IntegrationDispatchResponse],
)
async def dispatch_to_node(
    payload: IntegrationDispatchRequest,
    session: AsyncSession = Depends(get_db),
) -> SuccessResponse[IntegrationDispatchResponse]:
    task = await session.get(Task, payload.task_id)
    if task is None:
        raise AppError(404, "Task not found")
    node = await session.get(IntegrationNode, payload.node_id) if payload.node_id is not None else None
    if node is None:
        if payload.node_id is None:
            node = await session.scalar(
                select(IntegrationNode)
                .where(
                    IntegrationNode.workspace_id == task.workspace_id,
                    IntegrationNode.status.in_(["online", "busy"]),
                )
                .order_by(IntegrationNode.current_task_count.asc(), IntegrationNode.id.asc())
            )
        if node is None:
            raise AppError(409, "No available integration node found")
    if node.workspace_id != task.workspace_id:
        raise AppError(422, "Node must belong to the same workspace as the task")

    try:
        build_bridge(node.provider, node.workspace_id, node.name)
    except ValueError as exc:
        raise AppError(422, str(exc)) from exc

    package = DispatchPackage(
        acceptance_criteria=payload.acceptance_criteria,
        allowed_paths=payload.allowed_paths,
        test_command=payload.test_command,
        budget_seconds=payload.budget_seconds,
        budget_turns=payload.budget_turns,
        dependencies=payload.dependencies,
    )
    schedule_node_dispatch(task.id, node.id, package)

    return SuccessResponse(
        data=IntegrationDispatchResponse(
            task_id=task.id,
            node_id=node.id,
            node_name=node.name,
            success=True,
            message="Dispatch accepted; executing in background",
            metadata={"strategy": payload.strategy},
            status="accepted",
        )
    )


@router.delete(
    "/nodes/{node_id}",
    response_model=SuccessResponse[dict],
    status_code=status.HTTP_200_OK,
)
async def delete_node(
    node_id: int,
    session: AsyncSession = Depends(get_db),
) -> SuccessResponse[dict]:
    node = await session.get(IntegrationNode, node_id)
    if node is None:
        raise AppError(404, "Integration node not found")
    workspace_id = node.workspace_id
    await session.delete(node)
    await session.commit()

    await record_audit_log(
        session,
        workspace_id=workspace_id,
        action="integration_node.delete",
        resource_type="integration_node",
        resource_id=str(node_id),
        detail={"deleted": True},
    )
    await websocket_manager.broadcast_to_workspace(
        workspace_id,
        create_event("integration.status_changed", {"id": node_id, "status": "removed"}),
    )
    return SuccessResponse(data={"id": node_id, "deleted": True})
