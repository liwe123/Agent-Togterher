"""Shared pytest fixtures for Agent Console backend tests.

Provides throwaway async SQLite engines with all tables created, so
individual test files no longer need to roll their own
``create_async_engine`` + ``create_all`` boilerplate (PRD FR5).

Tests keep using temporary SQLite for speed; migration correctness is
covered separately by ``test_alembic_migrations.py``.
"""

from __future__ import annotations

import os
import tempfile
import time
import uuid
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.db.base import Base

# ---------------------------------------------------------------------------
# CI 挂起诊断（opt-in，默认关闭）
#
# 背景：CI build-linux job 曾间歇性在 TestClient 退出时挂死（cancellation 卡在
# 某个后台任务上），且 pytest -q 在挂起时零输出、只能等 6 小时 job 超时。
# 设置 PYTEST_WATCHDOG_SECONDS 后，watchdog 线程在“连续 N 秒没有任何测试进展”
# 时 dump：1) faulthandler 全线程栈；2) 所有事件循环的 asyncio 任务栈；然后
# 立即退出，让挂死位置直接出现在 CI 日志里。
# ---------------------------------------------------------------------------

_WATCHDOG_LAST_PROGRESS: dict[str, float] = {"ts": time.monotonic()}
_WATCHDOG_LOOPS: "set[Any]" = set()


def _install_progress_tracking() -> None:
    import asyncio

    original = asyncio.events._set_running_loop

    def _tracking_set_running_loop(loop: Any) -> Any:
        _WATCHDOG_LOOPS.add(loop)
        return original(loop)

    asyncio.events._set_running_loop = _tracking_set_running_loop


def _dump_async_tasks() -> None:
    import asyncio
    import sys
    import traceback

    for loop in list(_WATCHDOG_LOOPS):
        if not getattr(loop, "is_running", lambda: False)():
            continue
        try:
            tasks = asyncio.all_tasks(loop)
        except Exception:  # pragma: no cover - 诊断兜底
            continue
        for task in tasks:
            print(f"\n---- asyncio task: {task!r}", file=sys.__stderr__)
            try:
                for frame in task.get_stack():
                    line = traceback.format_list(
                        traceback.extract_stack(frame)
                    )
                    print("".join(line), file=sys.__stderr__, end="")
            except Exception:  # pragma: no cover - 诊断兜底
                continue


def _start_watchdog(idle_seconds: float) -> None:
    import faulthandler
    import sys
    import threading

    def watcher() -> None:
        print(
            f"[pytest-watchdog] started (idle threshold {idle_seconds:.0f}s)",
            file=sys.stderr,
            flush=True,
        )
        while True:
            time.sleep(5.0)
            idle = time.monotonic() - _WATCHDOG_LAST_PROGRESS["ts"]
            if idle < idle_seconds:
                continue
            print(
                f"\n===== PYTEST WATCHDOG: no test progress for {idle:.0f}s; "
                "dumping thread + asyncio task stacks =====",
                file=sys.__stderr__,
                flush=True,
            )
            faulthandler.dump_traceback(file=sys.__stderr__)
            _dump_async_tasks()
            sys.__stderr__.flush()
            os._exit(1)

    threading.Thread(target=watcher, name="pytest-watchdog", daemon=True).start()


def pytest_runtest_logstart(nodeid: str, location: Any) -> None:
    _WATCHDOG_LAST_PROGRESS["ts"] = time.monotonic()


def pytest_runtest_logreport(report: pytest.TestReport) -> None:
    _WATCHDOG_LAST_PROGRESS["ts"] = time.monotonic()


def pytest_configure(config: pytest.Config) -> None:
    """Pin the unit-test environment to a hermetic single-instance setup.

    C-169 turns on the Redis event bus and queue-based execution by deployment
    default. Unit tests must stay runnable with no external service and with
    the in-process dispatch semantics they were written against, so we pin the
    three switches here — before any test module imports ``app.main`` (which
    builds the event relay at import time).

    ``setdefault`` is deliberate: a test run that *wants* to exercise the real
    bus (e.g. an integration job) can still set the env vars explicitly. The
    bus-specific tests in ``test_distributed_event_bus.py`` and
    ``test_event_relay.py`` patch ``get_settings`` directly and are unaffected.
    """
    os.environ.setdefault("EVENT_BUS_ENABLED", "false")
    os.environ.setdefault("DISTRIBUTED_LOCK_ENABLED", "false")
    os.environ.setdefault("TASK_EXECUTION_MODE", "inline")
    # ``app.core.config`` reads ``../.env`` relative to the backend cwd, so a
    # developer checkout leaks the real dev ``DATABASE_URL`` (data/agent_console.db)
    # into the test process. Pin a throwaway per-run SQLite file so lifespan
    # migrations (TestClient startup) stay hermetic, same as the three switches
    # above. ``setdefault`` keeps an explicit override possible.
    os.environ.setdefault(
        "DATABASE_URL",
        "sqlite+aiosqlite:///"
        + (Path(tempfile.gettempdir()) / f"agent-console-pytest-{uuid.uuid4().hex}.db").as_posix(),
    )
    # CI 诊断看门狗（可选，默认关闭）：检测“测试进展停滞”而不是固定时长，
    # 覆盖收集/夹具/退出阶段（pytest-timeout 的 session-timeout 只覆盖测试执行）。
    watchdog_seconds = os.environ.get("PYTEST_WATCHDOG_SECONDS", "").strip()
    if watchdog_seconds:
        import faulthandler

        faulthandler.enable()
        _install_progress_tracking()
        _start_watchdog(float(watchdog_seconds))


@pytest_asyncio.fixture
async def db_engine(tmp_path) -> AsyncIterator[AsyncEngine]:
    """A throwaway async SQLite engine with all model tables created."""
    database_path = tmp_path / "agent-console-test.db"
    engine = create_async_engine(
        f"sqlite+aiosqlite:///{database_path.as_posix()}"
    )
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    yield engine
    await engine.dispose()


@pytest_asyncio.fixture
async def db_session_factory(db_engine: AsyncEngine) -> async_sessionmaker:
    """A session factory bound to the shared test engine.

    Use this (instead of ``db_session``) when the test needs to open
    multiple independent sessions, e.g. to observe background writes.
    """
    return async_sessionmaker(db_engine, expire_on_commit=False)


@pytest_asyncio.fixture
async def db_session(
    db_session_factory: async_sessionmaker,
) -> AsyncIterator[AsyncSession]:
    """A single session for straightforward single-session tests."""
    async with db_session_factory() as session:
        yield session
