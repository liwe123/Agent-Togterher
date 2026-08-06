from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.models import Workspace
from app.websocket.events import create_event
from app.websocket.manager import websocket_manager

router = APIRouter(tags=["websocket"])


@router.websocket("/ws/workspaces/{workspace_id}")
async def workspace_websocket(
    websocket: WebSocket,
    workspace_id: int,
    session: AsyncSession = Depends(get_db),
) -> None:
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
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        websocket_manager.disconnect(websocket)
