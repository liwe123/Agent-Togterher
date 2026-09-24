from fastapi.testclient import TestClient

from app.main import app


def test_health_check() -> None:
    with TestClient(app) as client:
        response = client.get("/api/v1/health")

    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_liveness_probe() -> None:
    with TestClient(app) as client:
        response = client.get("/api/v1/healthz")

    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_worker_instances_endpoint() -> None:
    """FR15: 存活 Worker 实例探针；事件总线关闭时降级为空列表。"""
    with TestClient(app) as client:
        response = client.get("/api/v1/healthz/workers")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert isinstance(body["count"], int)
    assert body["workers"] == []
