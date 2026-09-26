import logging

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import websocket_credential_is_valid, websocket_token
from app.db.session import get_db
from app.models import Workspace
from app.websocket.events import create_event
from app.websocket.manager import websocket_manager
from app.websocket.snapshot import WorkspaceSnapshotBuilder

logger = logging.getLogger(__name__)

router = APIRouter(tags=["websocket"])


def _origin_allowed(websocket: WebSocket) -> bool:
    allowed_origins = get_settings().ws_allowed_origins
    if not allowed_origins:
        return True
    origin = websocket.headers.get("origin")
    if origin is None:
        return True
    normalized = {value.rstrip("/") for value in allowed_origins}
    return origin.rstrip("/") in normalized


@router.websocket("/ws/workspaces/{workspace_id}")
async def workspace_websocket(
    websocket: WebSocket,
    workspace_id: int,
    session: AsyncSession = Depends(get_db),
) -> None:
    if not _origin_allowed(websocket) or not websocket_credential_is_valid(
        websocket_token(websocket)
    ):
        await websocket.accept()
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    workspace = await session.get(Workspace, workspace_id)
    if workspace is None:
        await websocket.accept()
        await websocket_manager.send_to_client(
            websocket,
            create_event("error", {"message": "Workspace not found"}),
        )
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    # 在接受连接前完成全部 DB 工作（快照构建 + 会话释放）：客户端在收到
    # 握手 accept 之前不会 cancel 服务端任务，因此取消不可能落在 SQL 上。
    # 若把 DB 操作留到 accept 之后，客户端退出时的 cancel scope 会中断正在
    # 执行的 SQL，SQLAlchemy 将 CancelledError 当作 DBAPI 异常触发
    # invalidate -> terminate 的 aiosqlite 优雅关闭竞争，导致事件循环取消
    # 阶段永久挂起（CI build-linux 间歇挂死根因）。accept 之后端点只做
    # WebSocket 收发，不再触碰数据库。
    snapshot_event = None
    try:
        builder = WorkspaceSnapshotBuilder(session)
        snapshot = await builder.build_snapshot(workspace_id)
        snapshot_event = builder.create_snapshot_event(workspace_id, snapshot)
    except Exception:
        logger.warning(
            "Failed to build workspace snapshot for workspace %s; continuing",
            workspace_id,
            exc_info=True,
        )
    finally:
        await session.close()

    await websocket_manager.connect(workspace_id, websocket)
    try:
        if snapshot_event is not None:
            await websocket_manager.send_to_client(websocket, snapshot_event)

        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        websocket_manager.disconnect(websocket)
