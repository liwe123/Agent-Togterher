from datetime import datetime, timezone

from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """Base class for SQLAlchemy models."""


def utc_now() -> datetime:
    """Return an aware UTC timestamp for model defaults."""
    return datetime.now(timezone.utc)
