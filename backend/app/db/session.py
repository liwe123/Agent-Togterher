from collections.abc import AsyncIterator
from pathlib import Path

from sqlalchemy import event, inspect, text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.core.config import get_settings
from app.db.base import Base
import app.models  # noqa: F401  # Register all model metadata before create_all.

settings = get_settings()
engine: AsyncEngine = create_async_engine(settings.database_url)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)


if settings.database_url.startswith("sqlite"):
    @event.listens_for(engine.sync_engine, "connect")
    def enable_sqlite_foreign_keys(dbapi_connection: object, _: object) -> None:
        cursor = dbapi_connection.cursor()  # type: ignore[attr-defined]
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()


async def init_db() -> None:
    """Create the SQLite directory and any registered tables."""
    if settings.database_url.startswith("sqlite"):
        database_path = make_url(settings.database_url).database
        if database_path and database_path != ":memory:":
            Path(database_path).expanduser().parent.mkdir(parents=True, exist_ok=True)

    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
        await connection.run_sync(_migrate_sqlite_schema)


def _migrate_sqlite_schema(connection) -> None:
    inspector = inspect(connection)
    if not inspector.has_table("tasks"):
        return
    columns = {column["name"] for column in inspector.get_columns("tasks")}
    alterations = []
    if "execution_token" not in columns:
        alterations.append("ALTER TABLE tasks ADD COLUMN execution_token VARCHAR(36)")
    if "execution_token_expires_at" not in columns:
        alterations.append(
            "ALTER TABLE tasks ADD COLUMN execution_token_expires_at DATETIME"
        )
    for statement in alterations:
        connection.execute(text(statement))


async def close_db() -> None:
    await engine.dispose()


async def get_db() -> AsyncIterator[AsyncSession]:
    """Yield one transaction-scoped database session per request."""
    async with AsyncSessionLocal() as session:
        yield session
