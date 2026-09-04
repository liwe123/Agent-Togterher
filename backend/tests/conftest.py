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
import uuid
from collections.abc import AsyncIterator
from pathlib import Path

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.db.base import Base


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
