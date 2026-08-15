import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.core.worker_registry import (
    NoopWorkerRegistry,
    WorkerRegistry,
    build_worker_registry,
)


class TestNoopWorkerRegistry:
    def test_start_is_noop(self) -> None:
        reg = NoopWorkerRegistry()
        asyncio.run(reg.start())

    def test_stop_is_noop(self) -> None:
        reg = NoopWorkerRegistry()
        asyncio.run(reg.stop())

    def test_list_workers_returns_empty(self) -> None:
        reg = NoopWorkerRegistry()
        workers = asyncio.run(reg.list_workers())
        assert workers == []

    def test_acquire_lock_returns_true(self) -> None:
        reg = NoopWorkerRegistry()
        result = asyncio.run(reg.acquire_lock("test", "owner"))
        assert result is True

    def test_release_lock_returns_true(self) -> None:
        reg = NoopWorkerRegistry()
        result = asyncio.run(reg.release_lock("test", "owner"))
        assert result is True

    def test_close_is_noop(self) -> None:
        reg = NoopWorkerRegistry()
        asyncio.run(reg.close())


class TestWorkerRegistry:
    @pytest.fixture
    def mock_redis(self):
        mock = MagicMock()
        mock.scan = AsyncMock(return_value=(0, []))
        mock.delete = AsyncMock()
        mock.hset = AsyncMock()
        mock.expire = AsyncMock()
        mock.setex = AsyncMock()
        mock.get = AsyncMock()
        mock.hgetall = AsyncMock(return_value={})
        mock.ttl = AsyncMock(return_value=-2)
        mock.eval = AsyncMock(return_value=1)
        mock.aclose = AsyncMock()
        with patch("app.core.worker_registry.redis.from_url") as m:
            m.return_value = mock
            yield mock

    def test_build_worker_registry_disabled(self) -> None:
        with patch("app.core.worker_registry.WorkerRegistry") as MockRegistry:
            reg = build_worker_registry("redis://localhost", "test-id", enabled=False)
            assert isinstance(reg, NoopWorkerRegistry)

    def test_build_worker_registry_enabled(self) -> None:
        with patch("app.core.worker_registry.redis.from_url") as mock_redis:
            mock_redis.return_value = MagicMock()
            reg = build_worker_registry("redis://localhost", "test-id", enabled=True)
            assert isinstance(reg, WorkerRegistry)

    def test_heartbeat_key(self) -> None:
        reg = WorkerRegistry("redis://localhost", "test-id", lease_timeout=90)
        assert reg._heartbeat_key == "agent_console:worker:heartbeat:test-id"

    def test_info_key(self) -> None:
        reg = WorkerRegistry("redis://localhost", "test-id", lease_timeout=90)
        assert reg._info_key == "agent_console:worker:info:test-id"

    def test_start_writes_info(self) -> None:
        mock_redis = MagicMock()
        with patch("app.core.worker_registry.redis.from_url", return_value=mock_redis):
            with patch("app.core.worker_registry.utc_now") as mock_now:
                mock_now.return_value.isoformat.return_value = "2026-01-01T00:00:00"
                reg = WorkerRegistry("redis://localhost", "test-id", lease_timeout=90)
                asyncio.run(reg.start({"custom": "value"}))
                mock_redis.hset.assert_called()
                mock_redis.expire.assert_called()

    def test_stop_cancels_sweep(self) -> None:
        mock_redis = MagicMock()
        mock_redis.scan = AsyncMock(return_value=(0, []))
        mock_redis.delete = AsyncMock()
        with patch("app.core.worker_registry.redis.from_url", return_value=mock_redis):
            reg = WorkerRegistry("redis://localhost", "test-id", lease_timeout=90)
            asyncio.run(reg.start())
            assert reg._sweep_task is not None
            asyncio.run(reg.stop())
            # After stop, sweep_task may still hold a cancelled task reference
            # The important thing is that it's cancelled
            if reg._sweep_task:
                assert reg._sweep_task.done()

    def test_list_workers(self) -> None:
        mock_redis = MagicMock()
        mock_redis.scan = AsyncMock(
            side_effect=[
                (0, ["agent_console:worker:heartbeat:id1", "agent_console:worker:heartbeat:id2"]),
                (0, []),
            ]
        )
        mock_redis.hgetall = AsyncMock(
            side_effect=[
                {"instance_id": "id1", "registered_at": "2026-01-01"},
                {"instance_id": "id2", "registered_at": "2026-01-01"},
            ]
        )
        with patch("app.core.worker_registry.redis.from_url", return_value=mock_redis):
            reg = WorkerRegistry("redis://localhost", "test-id", lease_timeout=90)
            workers = asyncio.run(reg.list_workers())
            assert len(workers) == 2

    def test_acquire_lock(self) -> None:
        mock_redis = MagicMock()
        mock_redis.set = AsyncMock(return_value=True)
        with patch("app.core.worker_registry.redis.from_url", return_value=mock_redis):
            reg = WorkerRegistry("redis://localhost", "test-id", lease_timeout=90)
            result = asyncio.run(reg.acquire_lock("my-lock", "test-id", ttl=10))
            assert result is True
            mock_redis.set.assert_called_once()

    def test_acquire_lock_fails(self) -> None:
        mock_redis = MagicMock()
        mock_redis.set = AsyncMock(return_value=None)
        with patch("app.core.worker_registry.redis.from_url", return_value=mock_redis):
            reg = WorkerRegistry("redis://localhost", "test-id", lease_timeout=90)
            result = asyncio.run(reg.acquire_lock("my-lock", "test-id", ttl=10))
            assert result is False

    def test_release_lock(self) -> None:
        mock_redis = MagicMock()
        mock_redis.eval = AsyncMock(return_value=1)
        with patch("app.core.worker_registry.redis.from_url", return_value=mock_redis):
            reg = WorkerRegistry("redis://localhost", "test-id", lease_timeout=90)
            result = asyncio.run(reg.release_lock("my-lock", "test-id"))
            assert result is True

    def test_release_lock_wrong_owner(self) -> None:
        mock_redis = MagicMock()
        mock_redis.eval = AsyncMock(return_value=0)
        with patch("app.core.worker_registry.redis.from_url", return_value=mock_redis):
            reg = WorkerRegistry("redis://localhost", "test-id", lease_timeout=90)
            result = asyncio.run(reg.release_lock("my-lock", "wrong-owner"))
            assert result is False

    def test_close(self) -> None:
        mock_redis = MagicMock()
        mock_redis.aclose = AsyncMock()
        with patch("app.core.worker_registry.redis.from_url", return_value=mock_redis):
            reg = WorkerRegistry("redis://localhost", "test-id", lease_timeout=90)
            asyncio.run(reg.close())
            mock_redis.aclose.assert_called_once()
