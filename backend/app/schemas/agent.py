from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, model_validator


class AgentCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    workspace_id: int = Field(gt=0)
    name: str = Field(min_length=1, max_length=100)
    role: str = Field(min_length=1, max_length=100)
    description: str = ""
    avatar: str | None = Field(default=None, max_length=255)
    model_name: str = Field(min_length=1, max_length=255)
    system_prompt: str = Field(min_length=1)
    status: str = Field(default="idle", min_length=1, max_length=32)


class AgentUpdate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    name: str | None = Field(default=None, min_length=1, max_length=100)
    role: str | None = Field(default=None, min_length=1, max_length=100)
    description: str | None = None
    avatar: str | None = Field(default=None, max_length=255)
    model_name: str | None = Field(default=None, min_length=1, max_length=255)
    system_prompt: str | None = Field(default=None, min_length=1)
    status: str | None = Field(default=None, min_length=1, max_length=32)
    last_active_at: datetime | None = None

    @model_validator(mode="after")
    def reject_empty_update_and_null_required_fields(self) -> "AgentUpdate":
        if not self.model_fields_set:
            raise ValueError("At least one field must be provided")
        required = {
            "name",
            "role",
            "description",
            "model_name",
            "system_prompt",
            "status",
        }
        if any(field in self.model_fields_set and getattr(self, field) is None for field in required):
            raise ValueError("Required agent fields cannot be null")
        return self


class AgentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    workspace_id: int
    name: str
    role: str
    description: str
    avatar: str | None
    model_name: str
    system_prompt: str
    status: str
    last_active_at: datetime | None
    created_at: datetime


class AgentStatusRead(BaseModel):
    id: int
    status: str
    last_active_at: datetime | None
