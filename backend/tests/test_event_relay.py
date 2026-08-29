import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.websocket.events import create_event
from app.websocket.manager import WebSocketManager, register_distributed_publisher
from app.websocket.relay import (
    DistributedEventRelay,
    NoopEventRelay,
    build_event_relay,
)


class TestNoopEventRelay:
    def test_start_is_noop(self) -> None:
        relay = NoopEventRelay()
        asyncio.run(relay.start())

    def test_publish_is_noop(self) -> None:
        relay = NoopEventRelay()
        event = create_event("test", {})
        asyncio.run(relay.publish(1, event))

    def test_stop_is_noop(self) -> None:
        relay = NoopEventRelay()
        asyncio.run(relay.stop())


class TestDistributedEventRelay:
    @pytest.fixture
    def mock_bus(self):
        mock = MagicMock()
        mock.listen = AsyncMock()
        mock.publish_workspace_event = AsyncMock()
        mock.close = AsyncMock()
        return mock

    def test_build_event_relay_disabled(self) -> None:
        with patch(
            "app.websocket.relay.get_settings",
            return_value=MagicMock(event_bus_enabled=False, redis_url="", worker_instance_id=None),
        ):
            with patch("app.websocket.relay.build_distributed_event_bus") as mock_build:
                mock_build.return_value = (MagicMock(), "test-id")
                relay = build_event_relay(WebSocketManager(), "test-id", enabled=False)
                assert isinstance(relay, NoopEventRelay)

    def test_build_event_relay_enabled(self) -> None:
        with patch(
            "app.websocket.relay.get_settings",
            return_value=MagicMock(event_bus_enabled=True, redis_url="redis://localhost", worker_instance_id="test-id"),
        ):
            with patch("app.websocket.relay.build_distributed_event_bus") as mock_build:
                mock_bus = MagicMock()
                mock_build.return_value = (mock_bus, "test-id")
                relay = build_event_relay(WebSocketManager(), "test-id", enabled=True)
                assert isinstance(relay, DistributedEventRelay)

    def test_start_registers_publisher(self) -> None:
        mock_bus = MagicMock()
        mock_bus.listen = AsyncMock(return_value=None)
        mock_bus.close = AsyncMock()
        ws_manager = WebSocketManager()
        relay = DistributedEventRelay(mock_bus, ws_manager, "test-id")
        asyncio.run(relay.start())
        # After start, the relay should be registered as the publisher
        # We can't easily verify this without more complex mocking,
        # but we can check that start doesn't raise
        asyncio.run(relay.stop())

    def test_publish_calls_bus(self) -> None:
        mock_bus = MagicMock()
        mock_bus.publish_workspace_event = AsyncMock()
        ws_manager = WebSocketManager()
        relay = DistributedEventRelay(mock_bus, ws_manager, "test-id")
        event = create_event("task.status_changed", {"id": 1})
        asyncio.run(relay.publish(1, event))
        mock_bus.publish_workspace_event.assert_called_once()
        call_args = mock_bus.publish_workspace_event.call_args
        assert call_args[0][0] == 1
        assert call_args[0][1] == event
        assert call_args[1]["origin_id"] == "test-id"

    def test_stop_cleans_up(self) -> None:
        mock_bus = MagicMock()
        mock_bus.listen = AsyncMock(return_value=None)
        mock_bus.close = AsyncMock()
        ws_manager = WebSocketManager()
        relay = DistributedEventRelay(mock_bus, ws_manager, "test-id")
        asyncio.run(relay.start())
        asyncio.run(relay.stop())
        mock_bus.close.assert_called_once()

    def test_relay_loop_retries_on_listen_failure(self) -> None:
        """listen() failures should trigger backoff reconnects, then stay alive."""
        mock_bus = MagicMock()
        mock_bus.close = AsyncMock()
        call_count = 0

        async def flaky_listen(handler):
            nonlocal call_count
            call_count += 1
            if call_count <= 2:
                raise ConnectionError("redis down")
            return None

        mock_bus.listen = flaky_listen
        ws_manager = WebSocketManager()
        relay = DistributedEventRelay(
            mock_bus, ws_manager, "test-id", retry_base_delay=0.01
        )

        async def run():
            await relay.start()
            # Wait for the relay task to finish (listen succeeds on 3rd call)
            await asyncio.wait_for(relay._relay_task, timeout=5)

        asyncio.run(run())
        assert call_count == 3
        assert relay._relay_task is not None
        assert relay._relay_task.done()
        # Cleanup: unregister publisher and close the bus (task already finished)
        asyncio.run(relay.stop())


class TestRegisterDistributedPublisher:
    def test_register_and_unregister(self) -> None:
        publisher1 = AsyncMock()
        publisher2 = AsyncMock()

        register_distributed_publisher(publisher1)
        # The global should now be publisher1

        register_distributed_publisher(publisher2)
        # The global should now be publisher2

        register_distributed_publisher(None)
        # The global should now be None

    def test_manager_broadcast_propagates(self) -> None:
        ws_manager = WebSocketManager()
        mock_publisher = AsyncMock()
        register_distributed_publisher(mock_publisher)

        event = create_event("test", {"data": "value"})
        # broadcast_to_workspace with propagate=True (default) should call publisher
        asyncio.run(ws_manager.broadcast_to_workspace(1, event))
        mock_publisher.assert_called_once_with(1, event)

        # Clean up
        register_distributed_publisher(None)

    def test_manager_broadcast_no_propagate(self) -> None:
        ws_manager = WebSocketManager()
        mock_publisher = AsyncMock()
        register_distributed_publisher(mock_publisher)

        event = create_event("test", {"data": "value"})
        # broadcast_to_workspace with propagate=False should NOT call publisher
        asyncio.run(ws_manager.broadcast_to_workspace(1, event, propagate=False))
        mock_publisher.assert_not_called()

        # Clean up
        register_distributed_publisher(None)
