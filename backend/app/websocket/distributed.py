from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, Awaitable, Callable, TypedDict
from uuid import uuid4

import redis.asyncio as redis
from fastapi.encoders import jsonable_encoder

from app.core.config import get_settings
from app.websocket.events import WebSocketEvent

logger = logging.getLogger(__name__)


class DistributedEventEnvelope(TypedDict):
    workspace_id: int
    origin_id: str
    event_id: str
    event: WebSocketEvent
    published_at: str


async def _maybe_await(value: Any) -> Any:
    if asyncio.iscoroutine(value) or asyncio.isfuture(value):
        return await value
    return value


class RedisDistributedEventBus:
    """Publish workspace events to Redis and stream remote events back."""

    def __init__(self, redis_url: str, instance_id: str) -> None:
        self._redis = redis.from_url(redis_url, decode_responses=True)
        self._pubsub = self._redis.pubsub()
        self._instance_id = instance_id
        self._closed = False

    @staticmethod
    def channel_name(workspace_id: int) -> str:
        return f"workspace:{workspace_id}:events"

    async def publish_workspace_event(
        self,
        workspace_id: int,
        event: WebSocketEvent,
        *,
        origin_id: str,
    ) -> None:
        envelope: DistributedEventEnvelope = {
            "workspace_id": workspace_id,
            "origin_id": origin_id,
            "event_id": uuid4().hex,
            "event": jsonable_encoder(event),
            "published_at": __import__("datetime").datetime.utcnow().isoformat(),
        }
        try:
            await _maybe_await(
                self._redis.publish(
                    self.channel_name(workspace_id),
                    json.dumps(envelope, ensure_ascii=False),
                )
            )
        except Exception:
            logger.warning(
                "Failed to publish distributed workspace event", exc_info=True
            )

    async def listen(
        self,
        handler: Callable[[DistributedEventEnvelope], Awaitable[None]],
    ) -> None:
        await _maybe_await(self._pubsub.psubscribe("workspace:*:events"))
        try:
            async for message in self._pubsub.listen():
                if self._closed:
                    return
                if message.get("type") not in {"message", "pmessage"}:
                    continue
                data = message.get("data")
                if not isinstance(data, str):
                    continue
                try:
                    envelope = json.loads(data)
                    if envelope.get("origin_id") == self._instance_id:
                        continue
                    await handler(envelope)
                except Exception:
                    logger.exception("Failed to process distributed workspace event")
        finally:
            with __import__("contextlib").suppress(Exception):
                await _maybe_await(self._pubsub.punsubscribe("workspace:*:events"))

    async def close(self) -> None:
        self._closed = True
        with __import__("contextlib").suppress(Exception):
            await _maybe_await(self._pubsub.close())
        with __import__("contextlib").suppress(Exception):
            await _maybe_await(self._redis.aclose())


class NoopDistributedEventBus:
    async def publish_workspace_event(
        self,
        workspace_id: int,
        event: WebSocketEvent,
        *,
        origin_id: str,
    ) -> None:
        return None

    async def listen(
        self,
        handler: Callable[[DistributedEventEnvelope], Awaitable[None]],
    ) -> None:
        await asyncio.sleep(0)
        return None

    async def close(self) -> None:
        return None


def build_distributed_event_bus(instance_id: str | None = None):
    settings = get_settings()
    resolved_instance_id = instance_id or settings.worker_instance_id or uuid4().hex
    if not settings.event_bus_enabled:
        return NoopDistributedEventBus(), resolved_instance_id
    return RedisDistributedEventBus(settings.redis_url, resolved_instance_id), resolved_instance_id
