from __future__ import annotations

import asyncio
import logging
from typing import Any

from app.core.config import get_settings
from app.websocket.distributed import DistributedEventEnvelope, build_distributed_event_bus
from app.websocket.events import WebSocketEvent
from app.websocket.manager import WebSocketManager, register_distributed_publisher

logger = logging.getLogger(__name__)


class DistributedEventRelay:
    """Relay distributed workspace events to local WebSocket clients.

    This component subscribes to the distributed event bus and forwards
    events to the appropriate workspace clients managed by the
    WebSocketManager.  It also publishes local events to the bus
    so other instances can receive them.
    """

    def __init__(
        self,
        bus: Any,
        websocket_manager: WebSocketManager,
        instance_id: str,
    ) -> None:
        self._bus = bus
        self._ws_manager = websocket_manager
        self._instance_id = instance_id
        self._relay_task: asyncio.Task[None] | None = None

    async def start(self) -> None:
        """Start the background relay loop."""
        register_distributed_publisher(self.publish)
        self._relay_task = asyncio.create_task(self._relay_loop())

    async def _relay_loop(self) -> None:
        await self._bus.listen(self._on_distributed_event)

    async def _on_distributed_event(self, envelope: DistributedEventEnvelope) -> None:
        workspace_id = envelope["workspace_id"]
        event: WebSocketEvent = envelope["event"]
        await self._ws_manager.broadcast_to_workspace(
            workspace_id,
            event,
            propagate=False,
        )

    async def publish(self, workspace_id: int, event: WebSocketEvent) -> None:
        """Publish a local event to the distributed bus."""
        await self._bus.publish_workspace_event(
            workspace_id,
            event,
            origin_id=self._instance_id,
        )

    async def stop(self) -> None:
        """Stop the relay loop and close the bus."""
        register_distributed_publisher(None)
        if self._relay_task:
            self._relay_task.cancel()
            with __import__("contextlib").suppress(asyncio.CancelledError):
                await self._relay_task
        await self._bus.close()


class NoopEventRelay:
    async def start(self) -> None:
        pass

    async def publish(self, workspace_id: int, event: WebSocketEvent) -> None:
        pass

    async def stop(self) -> None:
        pass


def build_event_relay(
    websocket_manager: WebSocketManager,
    instance_id: str,
    enabled: bool = True,
) -> DistributedEventRelay | NoopEventRelay:
    settings = get_settings()
    resolved_enabled = enabled and settings.event_bus_enabled
    bus, resolved_instance_id = build_distributed_event_bus(instance_id)
    if not resolved_enabled:
        return NoopEventRelay()
    return DistributedEventRelay(bus, websocket_manager, resolved_instance_id)
