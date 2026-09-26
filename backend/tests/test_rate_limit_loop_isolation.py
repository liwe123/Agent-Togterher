"""回归测试：限流 Redis 客户端不得跨事件循环复用（CI test-postgres 根因）。

背景：`quota_service` 曾使用进程级单例 `redis.asyncio` 客户端。redis 连接池
绑定创建它的 event loop；测试里每个 `TestClient` 各自新建并关闭事件循环，
复用时抛 `RuntimeError: got Future attached to a different loop`
（CI test-postgres 10 个用例因此失败，SQLite job 因无 Redis 走降级路径而掩盖）。

修复后的行为：
- 客户端随运行中的事件循环重建（循环变化即丢弃旧客户端）；
- 连接失配抛 ``RuntimeError`` 时也不冒泡，本次降级到进程内计数并重置客户端。
"""

from __future__ import annotations

import asyncio

from app.services import quota_service


def _fetch_client_in_new_loop():
    async def run():
        return quota_service._get_rate_limit_redis()

    return asyncio.run(run())


def test_rate_limit_client_recreated_when_event_loop_changes() -> None:
    quota_service._reset_rate_limit_redis()
    try:
        first = _fetch_client_in_new_loop()
        second = _fetch_client_in_new_loop()
        assert first is not None and second is not None
        assert first is not second, (
            "Redis 客户端必须随事件循环重建，否则连接池会带着旧循环复用"
        )
    finally:
        quota_service._reset_rate_limit_redis()


def test_rate_limit_degrades_on_stale_loop_runtime_error(monkeypatch) -> None:
    class StaleLoopRedis:
        async def incr(self, key: str) -> int:
            raise RuntimeError("got Future attached to a different loop")

        async def expire(self, key: str, ttl: int) -> bool:
            return True

    quota_service._reset_rate_limit_redis()
    monkeypatch.setattr(
        quota_service, "_get_rate_limit_redis", lambda: StaleLoopRedis()
    )
    try:
        result = asyncio.run(quota_service._check_rate_limit_redis(5, 60))
        assert result is None, "跨循环 RuntimeError 必须降级而不是向上抛出"
    finally:
        quota_service._reset_rate_limit_redis()


def test_rate_limit_uses_fresh_client_after_loop_change(monkeypatch) -> None:
    """端到端语义：循环切换后第二次调用使用新客户端（而非旧连接池）。"""

    class RecordingRedis:
        def __init__(self) -> None:
            self.calls = 0

        async def incr(self, key: str) -> int:
            self.calls += 1
            return 1

        async def expire(self, key: str, ttl: int) -> bool:
            return True

    created: list[RecordingRedis] = []
    real_factory = quota_service._get_rate_limit_redis

    def fake_factory():
        client = real_factory()
        if client is not None:
            created.append(client)
        return client

    monkeypatch.setattr(quota_service, "_get_rate_limit_redis", fake_factory)
    quota_service._reset_rate_limit_redis()
    try:
        first_run = asyncio.run(quota_service._check_rate_limit(21, 10))
        second_run = asyncio.run(quota_service._check_rate_limit(21, 10))
        assert first_run is True and second_run is True
        assert len(created) == 2, "两次不同循环的调用应各自使用新客户端"
        assert created[0] is not created[1]
    finally:
        quota_service._reset_rate_limit_redis()
