import asyncio
import logging
from collections import defaultdict
from collections.abc import Awaitable, Callable

from fastapi import WebSocket

from app.websocket.events import WebSocketEvent

logger = logging.getLogger(__name__)

_DistributedPublisher = Callable[[int, WebSocketEvent], Awaitable[None]]
_distributed_publisher: _DistributedPublisher | None = None


def register_distributed_publisher(publisher: _DistributedPublisher | None) -> None:
    """Register a publisher that mirrors local broadcasts to other instances."""
    global _distributed_publisher
    _distributed_publisher = publisher


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
        self,
        workspace_id: int,
        event: WebSocketEvent,
        *,
        propagate: bool = True,
    ) -> None:
        clients = tuple(self._connections.get(workspace_id, ()))
        if clients:
            await asyncio.gather(
                *(self.send_to_client(client, event) for client in clients)
            )
        if propagate and _distributed_publisher is not None:
            await _distributed_publisher(workspace_id, event)

    def get_workspace_client_count(self, workspace_id: int) -> int:
        return len(self._connections.get(workspace_id, ()))

    def get_total_client_count(self) -> int:
        return sum(len(clients) for clients in self._connections.values())


websocket_manager = WebSocketManager()
