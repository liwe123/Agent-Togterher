from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class ConversationCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    workspace_id: int = Field(gt=0)
    title: str = Field(min_length=1, max_length=255)


class ConversationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    workspace_id: int
    title: str
    created_at: datetime
    updated_at: datetime
