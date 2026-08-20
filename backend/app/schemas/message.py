from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import MessageType, SenderType
from app.schemas.agent import AgentRead
from app.schemas.task import TaskRead


class MessageCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    sender_type: SenderType
    sender_id: int | None = Field(default=None, gt=0)
    content: str = Field(min_length=1)
    message_type: MessageType = MessageType.NORMAL


class MessageRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    conversation_id: int
    sender_type: SenderType
    sender_id: int | None
    content: str
    message_type: MessageType
    created_at: datetime


class MessageHubRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    message: MessageRead
    task: TaskRead
    assigned_agent: AgentRead | None = None
