from functools import lru_cache

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime settings loaded from environment variables or a local .env."""

    app_name: str = "Agent Console API"
    app_env: str = "development"
    api_v1_prefix: str = "/api/v1"
    cors_origins: list[str] = ["http://localhost:3000", "http://127.0.0.1:3000"]

    database_url: str = "sqlite+aiosqlite:///./data/agent_console.db"
    redis_url: str = "redis://localhost:6379/0"

    litellm_default_model: str = ""
    models_config_path: str = ""
    model_request_timeout_seconds: float = Field(default=60.0, gt=0)
    openai_api_key: SecretStr | None = None
    anthropic_api_key: SecretStr | None = None
    gemini_api_key: SecretStr | None = None
    deepseek_api_key: SecretStr | None = None
    dashscope_api_key: SecretStr | None = None
    qwen_api_key: SecretStr | None = None

    model_config = SettingsConfigDict(
        env_file=(".env", "../.env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()
