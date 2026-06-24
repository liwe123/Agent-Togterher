import asyncio
from unittest.mock import AsyncMock

from fastapi import WebSocket

from app.websocket import WebSocketManager, create_event


def test_websocket_manager_connect_send_broadcast_and_disconnect() -> None:
    asyncio.run(_exercise_websocket_manager())


async def _exercise_websocket_manager() -> None:
    manager = WebSocketManager()
    first = AsyncMock(spec=WebSocket)
    second = AsyncMock(spec=WebSocket)
    event = create_event("error", {"message": "test"})

    await manager.connect(1, first)
    await manager.connect(1, second)
    first.accept.assert_awaited_once()
    second.accept.assert_awaited_once()

    assert await manager.send_to_client(first, event) is True
    first.send_json.assert_awaited_once_with(event)

    first.send_json.reset_mock()
    await manager.broadcast_to_workspace(1, event)
    first.send_json.assert_awaited_once_with(event)
    second.send_json.assert_awaited_once_with(event)

    manager.disconnect(first)
    first.send_json.reset_mock()
    second.send_json.reset_mock()
    await manager.broadcast_to_workspace(1, event)
    first.send_json.assert_not_awaited()
    second.send_json.assert_awaited_once_with(event)
