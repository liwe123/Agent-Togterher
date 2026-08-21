"""Migrate data from the legacy SQLite database into PostgreSQL.

Reads every table from the old SQLite file, inserts rows into the
PostgreSQL target in dependency order (parent tables first), verifies
row counts after the import, and supports a ``--dry-run`` preflight
mode that only reports what would be migrated (PRD FR4).

Usage (run from ``backend/``):

    # Preflight: report tables and row counts only
    python scripts/migrate_sqlite_to_pg.py --dry-run

    # Real migration with post-import row-count verification
    python scripts/migrate_sqlite_to_pg.py \
        --source sqlite+aiosqlite:///./data/agent_console.db \
        --target postgresql+asyncpg://agent:agent@db:5432/agent_console

The script is idempotent by design: target tables are emptied (in
reverse dependency order) before the import, so re-running it after a
partial failure converges to the source state.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

from sqlalchemy import delete, func, insert, inspect, select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

# Make `app` importable when the script is executed directly.
BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.db.base import Base  # noqa: E402
import app.models  # noqa: E402, F401  # Register all model metadata.

# Import order matters: parents (no FK dependencies) first, children last.
# Tables not listed here fall back to alphabetical order at the end.
IMPORT_ORDER = [
    "users",
    "workspaces",
    "provider_credentials",
    "custom_model_configs",
    "plugins",
    "workflow_templates",
    "workspace_memberships",
    "workspace_invitations",
    "quota_configs",
    "agents",
    "conversations",
    "messages",
    "tasks",
    "task_steps",
    "task_queue_items",
    "model_calls",
    "audit_logs",
    "integration_nodes",
    "workspace_plugins",
]


def _ordered_table_names(metadata_tables: dict) -> list[str]:
    """Return model table names in dependency order."""
    known = [name for name in IMPORT_ORDER if name in metadata_tables]
    extra = sorted(set(metadata_tables) - set(known))
    return known + extra


async def _existing_tables(session: AsyncSession) -> set[str]:
    result = await session.execute(
        text("SELECT name FROM sqlite_master WHERE type='table'")
    )
    return {row[0] for row in result.fetchall()}


async def _row_count(session: AsyncSession, table) -> int:
    return await session.scalar(select(func.count()).select_from(table))


async def migrate(source_url: str, target_url: str, dry_run: bool) -> int:
    source_engine = create_async_engine(source_url)
    target_engine = create_async_engine(target_url)
    source_factory = async_sessionmaker(source_engine, expire_on_commit=False)
    target_factory = async_sessionmaker(target_engine, expire_on_commit=False)

    try:
        async with source_factory() as session:
            existing = await _existing_tables(session)
            tables = [
                (name, Base.metadata.tables[name])
                for name in _ordered_table_names(Base.metadata.tables)
                if name in existing
            ]
            counts: dict[str, int] = {}
            for name, table in tables:
                counts[name] = await _row_count(session, table)

        print(f"[source] {source_url}")
        for name, count in counts.items():
            print(f"  {name}: {count} rows")
        total = sum(counts.values())

        if dry_run:
            print(f"[dry-run] would migrate {len(counts)} tables, {total} rows total.")
            return 0

        async with target_factory() as session:
            # Idempotency: clear target tables in reverse dependency order.
            for name, table in reversed(tables):
                await session.execute(delete(table))
            await session.commit()

        failures: list[str] = []
        async with source_factory() as src, target_factory() as dst:
            for name, table in tables:
                rows = [dict(row) for row in (await src.execute(select(table))).mappings()]
                if rows:
                    await dst.execute(insert(table), rows)
                await dst.commit()

                target_count = await _row_count(dst, table)
                if target_count != counts[name]:
                    failures.append(
                        f"{name}: source={counts[name]} target={target_count}"
                    )
                print(f"  migrated {name}: {counts[name]} rows")

        if failures:
            print("[FAILED] row-count mismatch:")
            for failure in failures:
                print(f"  {failure}")
            return 1

        print(f"[OK] migrated {len(counts)} tables, {total} rows, all counts match.")
        return 0
    finally:
        await source_engine.dispose()
        await target_engine.dispose()


def main() -> None:
    parser = argparse.ArgumentParser(description="SQLite -> PostgreSQL data migration")
    parser.add_argument(
        "--source",
        default="sqlite+aiosqlite:///./data/agent_console.db",
        help="Source SQLite URL (default: ./data/agent_console.db)",
    )
    parser.add_argument(
        "--target",
        default=None,
        help="Target PostgreSQL URL (default: app settings database_url)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Only report the tables and row counts that would be migrated",
    )
    args = parser.parse_args()

    target_url = args.target
    if target_url is None:
        from app.core.config import get_settings

        target_url = get_settings().database_url

    if target_url.startswith("sqlite"):
        print(
            "[error] target URL is SQLite; set --target or DATABASE_URL to the "
            "PostgreSQL database before migrating."
        )
        raise SystemExit(2)

    raise SystemExit(asyncio.run(migrate(args.source, target_url, args.dry_run)))


if __name__ == "__main__":
    main()
