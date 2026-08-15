import asyncio
from collections.abc import Iterator
from datetime import datetime, timezone
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base
from app.db.session import get_db
from app.main import app
from app.models.enums import TaskStatus
from app.models.task import Task, TaskStep
from app.models.workspace import Workspace


@pytest.fixture
def replay_client(tmp_path) -> Iterator[TestClient]:
    database_path = tmp_path / "replay-test.db"
    engine = create_async_engine(f"sqlite+aiosqlite:///{database_path.as_posix()}")
    session_factory = async_sessionmaker(engine, expire_on_commit=False)

    async def create_schema_and_task() -> tuple[int, int]:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)

        async with session_factory() as session:
            ws = Workspace(name="Replay WS", description="Replay Workspace")
            session.add(ws)
            await session.commit()
            await session.refresh(ws)

            task = Task(workspace_id=ws.id, title="Test Task for Replay", description="Test prompt", status=TaskStatus.COMPLETED)
            session.add(task)
            await session.commit()
            await session.refresh(task)

            now = datetime.now(timezone.utc)
            step1 = TaskStep(
                task_id=task.id,
                step_name="manager_plan",
                status="completed",
                input='{"prompt": "Test prompt"}',
                output='{"plan": ["step1", "step2"]}',
                started_at=now,
                finished_at=now,
            )
            step2 = TaskStep(
                task_id=task.id,
                step_name="worker_execute_1",
                status="failed",
                input='{"instruction": "write code"}',
                output=None,
                started_at=now,
                finished_at=now,
            )
            session.add_all([step1, step2])
            await session.commit()
            await session.refresh(step2)
            return task.id, step2.id

    task_id, step2_id = asyncio.run(create_schema_and_task())

    async def override_get_db():
        async with session_factory() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    try:
        with TestClient(app) as client:
            client.test_task_id = task_id
            client.test_step_id = step2_id
            yield client
    finally:
        app.dependency_overrides.clear()
        asyncio.run(engine.dispose())


def test_task_replay_flow(replay_client: TestClient) -> None:
    task_id = replay_client.test_task_id
    step2_id = replay_client.test_step_id

    # 1. 查询任务回放时序流
    res = replay_client.get(f"/api/v1/tasks/{task_id}/replay")
    assert res.status_code == 200
    data = res.json()["data"]
    assert data["task_id"] == task_id
    assert len(data["frames"]) == 2
    assert data["frames"][0]["step_name"] == "manager_plan"
    assert data["frames"][1]["status"] == "failed"

    # 2. 从失败步骤恢复执行
    resume_res = replay_client.post(
        f"/api/v1/tasks/{task_id}/resume-from-step",
        json={"step_id": step2_id, "custom_instruction": "Retry with fix"},
    )
    assert resume_res.status_code == 200
    resume_data = resume_res.json()["data"]
    assert resume_data["status"] == "pending"
    assert resume_data["resumed_step_id"] == step2_id
