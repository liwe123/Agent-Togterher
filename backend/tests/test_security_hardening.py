"""P0-4 安全加固测试：生产环境认证凭据 fail-closed 与 JWT 密钥策略。

- 非开发环境缺少 ``APP_API_TOKEN`` / ``JWT_SECRET_KEY`` 时拒绝启动；
- 开发环境不再使用硬编码公开 JWT 常量，改用进程级随机密钥；
- 非开发且未配置任何凭据时 JWT 签发 / 校验直接报错。
"""

from types import SimpleNamespace

import pytest
from pydantic import SecretStr

from app.core import auth as auth_module
from app.core.auth import create_access_token, get_user_id_from_token
from app.core.config import get_settings
from app.main import _assert_production_secrets


def test_production_requires_explicit_credentials() -> None:
    with pytest.raises(RuntimeError):
        _assert_production_secrets(
            SimpleNamespace(
                app_env="production", app_api_token=None, jwt_secret_key=None
            )
        )
    with pytest.raises(RuntimeError):
        _assert_production_secrets(
            SimpleNamespace(
                app_env="production",
                app_api_token=SecretStr(""),
                jwt_secret_key=SecretStr(""),
            )
        )

    # 任一凭据显式配置即可放行。
    _assert_production_secrets(
        SimpleNamespace(
            app_env="production",
            app_api_token=SecretStr("tok"),
            jwt_secret_key=None,
        )
    )
    _assert_production_secrets(
        SimpleNamespace(
            app_env="production",
            app_api_token=None,
            jwt_secret_key=SecretStr("secret"),
        )
    )


def test_development_environment_stays_open() -> None:
    _assert_production_secrets(
        SimpleNamespace(app_env="development", app_api_token=None, jwt_secret_key=None)
    )


def test_jwt_secret_requires_configuration_outside_development() -> None:
    settings = get_settings()
    original_env = settings.app_env
    original_token = settings.app_api_token
    original_secret = settings.jwt_secret_key
    settings.app_api_token = None
    settings.jwt_secret_key = None
    try:
        settings.app_env = "production"
        with pytest.raises(RuntimeError):
            auth_module._get_secret_key()

        settings.app_env = "development"
        secret = auth_module._get_secret_key()
        assert secret
        # 不再使用历史硬编码常量。
        assert secret != "agent-console-dev-secret-change-in-production"
    finally:
        settings.app_env = original_env
        settings.app_api_token = original_token
        settings.jwt_secret_key = original_secret


def test_dev_ephemeral_secret_round_trips_tokens() -> None:
    token = create_access_token(42)
    assert get_user_id_from_token(token) == 42
