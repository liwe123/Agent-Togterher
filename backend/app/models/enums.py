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
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


def string_enum(enum_class: type[StrEnum], name: str) -> Enum:
    """Build a portable string-backed enum with database constraints."""
    return Enum(
        enum_class,
        name=name,
        native_enum=False,
        create_constraint=True,
        validate_strings=True,
        values_callable=lambda members: [member.value for member in members],
    )
