import asyncio
import logging
from collections import defaultdict

from fastapi import WebSocket

from app.websocket.events import WebSocketEvent

logger = logging.getLogger(__name__)


class WebSocketManager:
    """Manage in-process WebSocket clients grouped by workspace."""

    def __init__(self) -> None:
        self._connections: dict[int, set[WebSocket]] = defaultdict(set)
        self._client_workspaces: dict[WebSocket, int] = {}

    async def connect(self, workspace_id: int, websocket: WebSocket) -> None:
        await websocket.accept()
        self._connections[workspace_id].add(websocket)
        self._client_workspaces[websocket] = workspace_id

    def disconnect(self, websocket: WebSocket) -> None:
        workspace_id = self._client_workspaces.pop(websocket, None)
        if workspace_id is None:
            return
        clients = self._connections.get(workspace_id)
        if clients is None:
            return
        clients.discard(websocket)
        if not clients:
            self._connections.pop(workspace_id, None)

    async def send_to_client(
        self, websocket: WebSocket, event: WebSocketEvent
    ) -> bool:
        try:
            await websocket.send_json(event)
        except Exception:
            logger.warning("WebSocket delivery failed; disconnecting client", exc_info=True)
            self.disconnect(websocket)
            return False
        return True

    async def broadcast_to_workspace(
        self, workspace_id: int, event: WebSocketEvent
    ) -> None:
        clients = tuple(self._connections.get(workspace_id, ()))
        if not clients:
            return
        await asyncio.gather(
            *(self.send_to_client(client, event) for client in clients)
        )


websocket_manager = WebSocketManager()
