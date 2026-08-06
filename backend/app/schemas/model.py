from pydantic import BaseModel, ConfigDict, Field


class ModelInfo(BaseModel):
    name: str
    provider: str
    configured: bool


class ModelTestRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    model_name: str = Field(min_length=1, max_length=255)
    prompt: str = Field(default="Reply with OK.", min_length=1, max_length=4000)
    workspace_id: int | None = Field(default=None, gt=0)


class ModelTokenUsage(BaseModel):
    prompt_tokens: int = Field(default=0, ge=0)
    completion_tokens: int = Field(default=0, ge=0)
    total_tokens: int = Field(default=0, ge=0)


class ModelTestResult(BaseModel):
    requested_model: str
    model_name: str
    provider: str
    content: str
    # Kept for clients from phases 3-4; it contains the same text as content.
    response: str
    usage: ModelTokenUsage
    latency_ms: int
    fallback_used: bool


class ModelConfigInfo(BaseModel):
    """Model role configuration from models.yaml; never exposes API keys."""

    name: str
    provider: str
    model: str
    purpose: str
    fallback_model: str | None


class ProviderStatusInfo(BaseModel):
    """Whether a provider's API key is configured (no key value exposed)."""

    provider: str
    configured: bool
