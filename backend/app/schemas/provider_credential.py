from pydantic import BaseModel, ConfigDict, Field


class ProviderKeyUpsert(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    api_key: str = Field(min_length=1, max_length=500)


class ProviderKeyValue(BaseModel):
    """Credential metadata safe to return through the API."""

    provider: str
    configured: bool
    masked_key: str | None = None
    source: str | None = None

