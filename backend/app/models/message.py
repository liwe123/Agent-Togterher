from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, utc_now
from app.models.enums import MessageType, SenderType, string_enum

if TYPE_CHECKING:
    from app.models.conversation import Conversation
    from app.models.task import Task


class Message(Base):
    __tablename__ = "messages"

    id: Mapped[int] = mapped_column(primary_key=True)
    conversation_id: Mapped[int] = mapped_column(
        ForeignKey("conversations.id", ondelete="CASCADE"), index=True
    )
    sender_type: Mapped[SenderType] = mapped_column(
        string_enum(SenderType, "sender_type_enum")
    )
    sender_id: Mapped[int | None] = mapped_column(nullable=True, index=True)
    content: Mapped[str] = mapped_column(Text)
    message_type: Mapped[MessageType] = mapped_column(
        string_enum(MessageType, "message_type_enum"), default=MessageType.NORMAL
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now
    )

    conversation: Mapped["Conversation"] = relationship(back_populates="messages")
    input_for_tasks: Mapped[list["Task"]] = relationship(
        back_populates="input_message", foreign_keys="Task.input_message_id"
    )
