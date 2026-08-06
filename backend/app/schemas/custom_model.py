from __future__ import annotations
from pydantic import BaseModel, ConfigDict, Field

class CustomModelCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    name: str = Field(min_length=1, max_length=100)
    provider: str = Field(min_length=1, max_length=50)
    model: str = Field(min_length=1, max_length=255)
    purpose: str = Field(default="", max_length=500)
    fallback_model: str | None = Field(default=None, max_length=100)

class CustomModelRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    name: str
    provider: str
    model: str
    purpose: str
    fallback_model: str | None = None
