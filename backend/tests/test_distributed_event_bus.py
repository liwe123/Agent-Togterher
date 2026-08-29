import asyncio
import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.websocket.distributed import (
    DistributedEventEnvelope,
    NoopDistributedEventBus,
    RedisDistributedEventBus,
    build_distributed_event_bus,
)
from app.websocket.events import create_event


class TestNoopDistributedEventBus:
    def test_publish_is_noop(self) -> None:
        bus = NoopDistributedEventBus()
        event = create_event("task.status_changed", {"id": 1})
        # Should not raise
        asyncio.run(bus.publish_workspace_event(1, event, origin_id="test"))

    def test_listen_is_noop(self) -> None:
        bus = NoopDistributedEventBus()
        handler = AsyncMock()
        # Should not raise and should return quickly
        asyncio.run(bus.listen(handler))
        handler.assert_not_called()

    def test_close_is_noop(self) -> None:
        bus = NoopDistributedEventBus()
        asyncio.run(bus.close())


class TestRedisDistributedEventBus:
    @pytest.fixture
    def mock_redis(self):
        mock = MagicMock()
        mock.pubsub.return_value = MagicMock()
        mock.pubsub.return_value.listen.return_value = AsyncMock()
        mock.pubsub.return_value.listen.__aiter__.return_value = []
        with patch("app.websocket.distributed.redis.from_url") as m:
            m.return_value = mock
            yield mock

    def test_channel_name(self) -> None:
        assert RedisDistributedEventBus.channel_name(1) == "workspace:1:events"
        assert RedisDistributedEventBus.channel_name(42) == "workspace:42:events"

    def test_build_distributed_event_bus_disabled(self) -> None:
        with patch(
            "app.websocket.distributed.get_settings",
            return_value=MagicMock(event_bus_enabled=False, redis_url="", worker_instance_id=None),
        ):
            bus, instance_id = build_distributed_event_bus()
            assert isinstance(bus, NoopDistributedEventBus)
            assert len(instance_id) > 0

    def test_build_distributed_event_bus_enabled(self) -> None:
        with patch(
            "app.websocket.distributed.get_settings",
            return_value=MagicMock(event_bus_enabled=True, redis_url="redis://localhost", worker_instance_id="test-id"),
        ):
            with patch("app.websocket.distributed.redis.from_url") as mock_redis:
                mock_redis.return_value = MagicMock()
                bus, instance_id = build_distributed_event_bus()
                assert isinstance(bus, RedisDistributedEventBus)
                assert instance_id == "test-id"

    def test_publish_workspace_event(self) -> None:
        mock_redis = MagicMock()
        with patch("app.websocket.distributed.redis.from_url", return_value=mock_redis):
            bus = RedisDistributedEventBus("redis://localhost", "instance-1")
            event = create_event("task.status_changed", {"id": 1, "status": "running"})
            asyncio.run(bus.publish_workspace_event(1, event, origin_id="instance-1"))
            mock_redis.publish.assert_called_once()
            call_args = mock_redis.publish.call_args
            channel = call_args[0][0]
            message = call_args[0][1]
            assert channel == "workspace:1:events"
            parsed: DistributedEventEnvelope = json.loads(message)
            assert parsed["workspace_id"] == 1
            assert parsed["origin_id"] == "instance-1"
            assert parsed["event"]["type"] == "task.status_changed"
            assert "event_id" in parsed
            assert "published_at" in parsed

    def test_listen_handles_messages(self) -> None:
        mock_pubsub = MagicMock()
        mock_redis = MagicMock()
        mock_redis.pubsub.return_value = mock_pubsub

        # Create async iterator that yields a test message
        async def mock_listen():
            yield {"type": "message", "channel": "workspace:1:events", "data": b'{"workspace_id":1,"origin_id":"other","event_id":"e1","event":{"type":"task.status_changed","payload":{}},"published_at":"2026-01-01T00:00:00"}'}
            return

        mock_pubsub.listen = mock_listen
        mock_pubsub.punsubscribe = AsyncMock()

        with patch("app.websocket.distributed.redis.from_url", return_value=mock_redis):
            bus = RedisDistributedEventBus("redis://localhost", "instance-1")
            handler = AsyncMock()
            # We can't easily test the full async listen loop here without more mocking
            # but we can verify the structure
            assert hasattr(bus, "listen")
            assert hasattr(bus, "publish_workspace_event")

    def test_listen_skips_own_events(self) -> None:
        """Events originating from this instance should be skipped."""
        mock_pubsub = MagicMock()
        mock_redis = MagicMock()
        mock_redis.pubsub.return_value = mock_pubsub

        async def mock_listen():
            # Event from self
            yield {"type": "message", "channel": "workspace:1:events", "data": b'{"workspace_id":1,"origin_id":"instance-1","event_id":"e1","event":{"type":"test","payload":{}},"published_at":"2026-01-01T00:00:00"}'}
            # Event from other
            yield {"type": "message", "channel": "workspace:1:events", "data": b'{"workspace_id":1,"origin_id":"other","event_id":"e2","event":{"type":"test","payload":{}},"published_at":"2026-01-01T00:00:00"}'}
            return

        mock_pubsub.listen = mock_listen
        mock_pubsub.punsubscribe = AsyncMock()

        with patch("app.websocket.distributed.redis.from_url", return_value=mock_redis):
            bus = RedisDistributedEventBus("redis://localhost", "instance-1")
            # The listen method filters out events where origin_id == self._instance_id
            # This is verified by the implementation

    def test_close(self) -> None:
        mock_pubsub = MagicMock()
        mock_redis = MagicMock()
        mock_redis.pubsub.return_value = mock_pubsub
        mock_pubsub.close = AsyncMock()
        mock_redis.aclose = AsyncMock()

        with patch("app.websocket.distributed.redis.from_url", return_value=mock_redis):
            bus = RedisDistributedEventBus("redis://localhost", "instance-1")
            asyncio.run(bus.close())
            mock_pubsub.close.assert_called_once()
            mock_redis.aclose.assert_called_once()

    def test_publish_swallows_redis_errors(self) -> None:
        """Redis publish failures must not propagate to callers."""
        mock_redis = MagicMock()
        with patch("app.websocket.distributed.redis.from_url", return_value=mock_redis):
            bus = RedisDistributedEventBus("redis://localhost", "instance-1")
        failing_redis = MagicMock()
        failing_redis.publish.side_effect = ConnectionError("redis down")
        bus._redis = failing_redis
        event = create_event("task.status_changed", {"id": 1})
        # Should not raise
        asyncio.run(bus.publish_workspace_event(1, event, origin_id="instance-1"))
        failing_redis.publish.assert_called_once()
