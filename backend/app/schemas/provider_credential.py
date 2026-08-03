from pydantic import BaseModel, ConfigDict, Field


class ProviderKeyUpsert(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    api_key: str = Field(min_length=1, max_length=500)


class ProviderKeyValue(BaseModel):
    """Key value returned only on explicit per-provider GET (local tool)."""

    provider: str
    configured: bool
    api_key: str | None = None

