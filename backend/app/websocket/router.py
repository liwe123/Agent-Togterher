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

        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        websocket_manager.disconnect(websocket)
