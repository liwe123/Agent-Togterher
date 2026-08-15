from datetime import datetime
from typing import Any
from pydantic import BaseModel, Field


class PluginToolParameter(BaseModel):
    name: str
    type: str = "string"
    description: str = ""
    required: bool = False


class PluginToolDefinition(BaseModel):
    name: str
    description: str
    parameters: dict[str, Any] = Field(default_factory=dict)
    endpoint: str | None = None
    method: str = "POST"


class PluginManifest(BaseModel):
    name: str
    version: str = "1.0.0"
    display_name: str
    description: str = ""
    icon: str | None = None
    author: str | None = None
    base_url: str | None = None
    tools: list[PluginToolDefinition] = Field(default_factory=list)


class PluginCreate(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    display_name: str = Field(min_length=2, max_length=255)
    description: str | None = None
    version: str = "1.0.0"
    icon: str | None = None
    author: str | None = None
    manifest_json: str
    is_public: bool = True


class PluginResponse(BaseModel):
    id: int
    name: str
    display_name: str
    description: str | None
    version: str
    icon: str | None
    author: str | None
    manifest: dict[str, Any]
    is_public: bool
    is_installed: bool = False
    is_enabled: bool = False
    tools_count: int = 0
    created_at: datetime
    updated_at: datetime


class WorkspacePluginToggle(BaseModel):
    is_enabled: bool
    config: dict[str, Any] | None = None


class WorkspacePluginResponse(BaseModel):
    workspace_id: int
    plugin_id: int
    is_enabled: bool
    config: dict[str, Any] | None = None
    updated_at: datetime
