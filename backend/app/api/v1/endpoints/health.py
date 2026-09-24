import logging
from typing import Any

from fastapi import APIRouter

from app.core.config import get_settings
from app.core.worker_registry import build_worker_registry

logger = logging.getLogger(__name__)

router = APIRouter(tags=["health"])


@router.get("/health")
async def health_check() -> dict[str, str]:
    """Return a lightweight process health response."""
    settings = get_settings()
    return {
        "status": "ok",
        "service": settings.app_name,
        "environment": settings.app_env,
    }


@router.get("/healthz")
async def liveness_probe() -> dict[str, Any]:
    """Kubernetes-style liveness probe: the process is up and serving.

    FR15 弹性预留：探针本身零外部依赖（不触碰 DB/Redis），供编排器高频调用。
    """
    settings = get_settings()
    return {"status": "ok", "service": settings.app_name}


@router.get("/healthz/workers")
async def worker_instances() -> dict[str, Any]:
    """Return the currently-alive worker instances (best-effort).

    FR15 弹性预留：暴露存活 Worker 实例列表与数量，作为后续自动扩缩容的观测
    输入。Redis 不可用或事件总线关闭时降级为空列表，绝不抛错。
    """
    settings = get_settings()
    registry = build_worker_registry(
        settings.redis_url,
        instance_id="healthz-probe",
        lease_timeout=settings.worker_lease_timeout,
        enabled=settings.event_bus_enabled,
    )
    workers: list[dict[str, Any]] = []
    try:
        workers = await registry.list_workers()
    except Exception:
        logger.warning("Failed to list worker instances", exc_info=True)
    finally:
        try:
            await registry.close()
        except Exception:
            logger.debug("Failed to close probe registry", exc_info=True)
    return {"status": "ok", "count": len(workers), "workers": workers}
