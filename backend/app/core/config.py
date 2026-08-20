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
    event_bus_enabled: bool = False
    worker_instance_id: str = Field(default_factory=lambda: __import__("uuid").uuid4().hex)
    worker_heartbeat_interval: int = Field(default=30, ge=1)
    worker_lease_timeout: int = Field(default=90, ge=1)
    distributed_lock_enabled: bool = False
    app_api_token: SecretStr | None = None
    jwt_secret_key: SecretStr | None = None

    litellm_default_model: str = ""
    models_config_path: str = ""
    model_request_timeout_seconds: float = Field(default=60.0, gt=0)
    agent_tools_enabled: bool = True
    task_execution_mode: str = "inline"
    bridge_root_dir: str = "data/bridges"
    bridge_output_poll_timeout_seconds: int = Field(default=600, ge=1)
    worker_poll_interval_seconds: float = Field(default=1.0, gt=0)
    worker_concurrency: int = Field(default=2, ge=1, le=64)
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
