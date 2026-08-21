"""Alembic migration correctness tests (PRD FR5 / AC2-AC4).

Runs the real migration chain (``alembic upgrade head`` /
``alembic downgrade base``) against a throwaway SQLite database and
verifies:

- upgrading an empty database creates every model table (AC3);
- downgrading to base drops everything except alembic's own bookkeeping
  table (AC4);
- after ``upgrade head`` autogenerate reports no pending schema changes,
  proving the baseline migration is in sync with the models (AC2).

The PostgreSQL end-to-end variant is covered by the docker-compose
smoke test (AC1) which runs the same chain on a real PG instance.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from sqlalchemy import create_engine, inspect

from app.db.base import Base
import app.models  # noqa: F401  # Register all model metadata.

BACKEND_ROOT = Path(__file__).resolve().parents[1]
ALEMBIC_INI = BACKEND_ROOT / "alembic.ini"

MODEL_TABLES = set(Base.metadata.tables)


def _alembic_config(database_path: Path) -> Config:
    """Build an Alembic config bound to a temporary SQLite database."""
    cfg = Config(str(ALEMBIC_INI))
    cfg.set_main_option(
        "sqlalchemy.url",
        f"sqlite+aiosqlite:///{database_path.as_posix()}",
    )
    return cfg


def _sync_engine(database_path: Path):
    """A synchronous engine for inspection / autogenerate comparison."""
    return create_engine(f"sqlite:///{database_path.as_posix()}")


def test_upgrade_head_creates_all_model_tables(tmp_path) -> None:
    database_path = tmp_path / "migrate-up.db"
    command.upgrade(_alembic_config(database_path), "head")

    with _sync_engine(database_path).connect() as connection:
        tables = set(inspect(connection).get_table_names())

    assert MODEL_TABLES <= tables


def test_downgrade_base_drops_all_model_tables(tmp_path) -> None:
    database_path = tmp_path / "migrate-down.db"
    cfg = _alembic_config(database_path)
    command.upgrade(cfg, "head")
    command.downgrade(cfg, "base")

    with _sync_engine(database_path).connect() as connection:
        tables = set(inspect(connection).get_table_names())

    # Only alembic's own bookkeeping table may remain.
    assert tables <= {"alembic_version"}


def test_autogenerate_has_no_pending_changes(tmp_path) -> None:
    database_path = tmp_path / "migrate-autogen.db"
    command.upgrade(_alembic_config(database_path), "head")

    with _sync_engine(database_path).connect() as connection:
        context = MigrationContext.configure(connection)
        diff = compare_metadata(context, Base.metadata)

    assert diff == [], f"models and migrations are out of sync: {diff}"
