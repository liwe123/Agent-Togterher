from enum import StrEnum

from sqlalchemy import Enum


class SenderType(StrEnum):
    USER = "user"
    AGENT = "agent"
    SYSTEM = "system"


class MessageType(StrEnum):
    NORMAL = "normal"
    TASK = "task"
    RECEIPT = "receipt"  # Reserved for future read-receipt feature
    ERROR = "error"


class TaskStatus(StrEnum):
    PENDING = "pending"
    RUNNING = "running"
    WAITING_APPROVAL = "waiting_approval"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


def string_enum(enum_class: type[StrEnum], name: str) -> Enum:
    """Build a portable string-backed enum with database constraints."""
    return Enum(
        enum_class,
        name=name,
        native_enum=False,
        # We intentionally do NOT emit database CHECK constraints.
        # SQLite reflects CHECK constraints as table-level objects with no
        # column association, which causes Alembic autogenerate to report
        # spurious "remove_constraint" diffs on every run. SQLAlchemy still
        # validates enum values at the ORM level, so data integrity is
        # preserved for normal application writes.
        create_constraint=False,
        validate_strings=True,
        values_callable=lambda members: [member.value for member in members],
    )
