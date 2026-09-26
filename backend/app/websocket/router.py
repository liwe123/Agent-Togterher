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

    await websocket_manager.connect(workspace_id, websocket)
    try:
        try:
            builder = WorkspaceSnapshotBuilder(session)
            snapshot = await builder.build_snapshot(workspace_id)
            await websocket_manager.send_to_client(
                websocket,
                builder.create_snapshot_event(workspace_id, snapshot),
            )
        except Exception:
            logger.warning(
                "Failed to build workspace snapshot for workspace %s; continuing",
                workspace_id,
                exc_info=True,
            )
        finally:
            # 提前释放 DB 会话：WS 长连接的后续生命周期不再持有会话。
            # 否则客户端断开（WebSocketTestSession 会 cancel 服务端任务）时，
            # FastAPI 依赖清理中的 session.close()/rollback 在取消上下文里
            # 执行 DB 操作，会把 CancelledError 当作 DBAPI 异常触发
            # invalidate -> terminate 的 aiosqlite 优雅关闭竞争，导致事件循环
            # 取消阶段永久挂起（CI build-linux 间歇挂死根因）。
            await session.close()

        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        websocket_manager.disconnect(websocket)
