from functools import lru_cache

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime settings loaded from environment variables or a local .env."""

    app_name: str = "Agent Console API"
    app_env: str = "development"
    api_v1_prefix: str = "/api/v1"
    cors_origins: list[str] = ["http://localhost:3000", "http://127.0.0.1:3000"]
    ws_allowed_origins: list[str] = []

    database_url: str = "postgresql+asyncpg://agent:agent@db:5432/agent_console"
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
    # "queue"  = 任务入持久化队列，由独立 Worker 进程消费（默认，C-170）
    # "inline" = 在 API 进程内直接执行（保留作回退与单机调试路径）
    task_execution_mode: str = "queue"
    bridge_root_dir: str = "data/bridges"
    bridge_output_poll_timeout_seconds: int = Field(default=600, ge=1)
    # Codex bridge hardening (P1). --skip-git-repo-check is kept default-True
    # for backwards compat (bridge task dirs are not git repos), but should be
    # set False once worktree isolation (P5) makes task dirs real git repos.
    bridge_codex_skip_git_check: bool = True
    bridge_codex_timeout_seconds: int = Field(default=300, ge=1)
    worker_poll_interval_seconds: float = Field(default=1.0, gt=0)
    worker_concurrency: int = Field(default=2, ge=1, le=64)
    # C-171：任务执行期间的租约续期间隔与失联回收间隔（秒）。
    # 续期间隔须显著小于租约时长，否则长任务会被误判失联并重复消费。
    worker_lease_renew_interval_seconds: float = Field(default=30.0, gt=0)
    worker_recover_interval_seconds: float = Field(default=60.0, gt=0)
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
