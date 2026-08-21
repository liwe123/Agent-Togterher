"""Shared pytest fixtures for Agent Console backend tests.

Provides throwaway async SQLite engines with all tables created, so
individual test files no longer need to roll their own
``create_async_engine`` + ``create_all`` boilerplate (PRD FR5).

Tests keep using temporary SQLite for speed; migration correctness is
covered separately by ``test_alembic_migrations.py``.
"""

from __future__ import annotations

from collections.abc import AsyncIterator

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.db.base import Base


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
