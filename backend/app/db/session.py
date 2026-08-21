import asyncio
from collections.abc import AsyncIterator
from pathlib import Path

from sqlalchemy import event
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.core.config import get_settings

settings = get_settings()


def _build_engine(url: str) -> AsyncEngine:
    """Create the async engine with dialect-specific tuning.

    PostgreSQL gets a bounded connection pool with pre-ping and recycle;
    SQLite keeps SQLAlchemy defaults.
    """
    engine_kwargs: dict = {}
    if not url.startswith("sqlite"):
        engine_kwargs.update(
            pool_size=10,
            max_overflow=20,
            pool_pre_ping=True,
            pool_recycle=1800,
        )
    return create_async_engine(url, **engine_kwargs)


engine: AsyncEngine = _build_engine(settings.database_url)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)


if settings.database_url.startswith("sqlite"):

    @event.listens_for(engine.sync_engine, "connect")
    def enable_sqlite_foreign_keys(dbapi_connection: object, _: object) -> None:
        cursor = dbapi_connection.cursor()  # type: ignore[attr-defined]
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()


def _run_alembic_upgrade() -> None:
    """Run ``alembic upgrade head`` via the Alembic command API.

    Runs in a worker thread (called via asyncio.to_thread) so the async
    event loop is not blocked by the synchronous migration driver.
    """
    from alembic import command
    from alembic.config import Config

    alembic_ini_path = Path(__file__).resolve().parents[2] / "alembic.ini"
    if not alembic_ini_path.exists():
        raise RuntimeError(
            f"alembic.ini not found at {alembic_ini_path}; "
            "database schema cannot be migrated. Ensure the deployment "
            "includes the alembic directory."
        )
    alembic_cfg = Config(str(alembic_ini_path))
    alembic_cfg.set_main_option("sqlalchemy.url", settings.database_url)
    command.upgrade(alembic_cfg, "head")


async def init_db() -> None:
    """Prepare the database directory (SQLite) and apply Alembic migrations.

    Table creation is driven by ``alembic upgrade head`` instead of
    ``Base.metadata.create_all`` so schema evolution stays auditable and
    reversible. Seed data and task recovery are handled by the caller.
    """
    if settings.database_url.startswith("sqlite"):
        from sqlalchemy.engine import make_url

        database_path = make_url(settings.database_url).database
        if database_path and database_path != ":memory:":
            Path(database_path).expanduser().parent.mkdir(parents=True, exist_ok=True)

    await asyncio.to_thread(_run_alembic_upgrade)


async def close_db() -> None:
    await engine.dispose()


async def get_db() -> AsyncIterator[AsyncSession]:
    """Yield one transaction-scoped database session per request."""
    async with AsyncSessionLocal() as session:
        yield session
