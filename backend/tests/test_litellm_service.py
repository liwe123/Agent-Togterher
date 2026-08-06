import asyncio
from pathlib import Path

import pytest

from app.core.config import Settings
from app.services import litellm_service


ROOT_MODELS_CONFIG = Path(__file__).resolve().parents[2] / "config" / "models.yaml"


def _settings(**values) -> Settings:
    return Settings(
        _env_file=None,
        models_config_path=str(ROOT_MODELS_CONFIG),
        **values,
    )


def test_chat_completion_returns_content_usage_and_metadata(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = _settings(deepseek_api_key="unit-test-deepseek-key")
    captured: dict = {}

    async def fake_acompletion(**kwargs):
        captured.update(kwargs)
        return {
            "choices": [{"message": {"content": "pong"}}],
            "usage": {
                "prompt_tokens": 4,
                "completion_tokens": 2,
                "total_tokens": 6,
            },
        }

    monkeypatch.setattr(litellm_service, "get_settings", lambda: settings)
    monkeypatch.setattr(
        litellm_service, "_import_acompletion", lambda: fake_acompletion
    )
    litellm_service.clear_model_config_cache()

    result = asyncio.run(
        litellm_service.chat_completion(
            "code_model",
            [{"role": "user", "content": "ping"}],
            temperature=0.2,
        )
    )

    assert result.content == "pong"
    assert result.model_name == "deepseek/deepseek-chat"
    assert result.provider == "deepseek"
    assert result.requested_model == "code_model"
    assert result.usage.prompt_tokens == 4
    assert result.usage.completion_tokens == 2
    assert result.usage.total_tokens == 6
    assert result.fallback_used is False
    assert captured["model"] == "deepseek/deepseek-chat"
    assert captured["temperature"] == 0.2
    assert captured["api_key"] == "unit-test-deepseek-key"


def test_chat_completion_uses_configured_fallback(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = _settings(
        deepseek_api_key="unit-test-deepseek-key",
        qwen_api_key="unit-test-qwen-key",
    )
    attempted_models: list[str] = []

    async def fake_acompletion(**kwargs):
        attempted_models.append(kwargs["model"])
        if kwargs["model"] == "deepseek/deepseek-chat":
            raise TimeoutError("provider timeout")
        return {
            "choices": [{"message": {"content": "fallback ok"}}],
            "usage": {"prompt_tokens": 3, "completion_tokens": 2},
        }

    monkeypatch.setattr(litellm_service, "get_settings", lambda: settings)
    monkeypatch.setattr(
        litellm_service, "_import_acompletion", lambda: fake_acompletion
    )
    litellm_service.clear_model_config_cache()

    result = asyncio.run(
        litellm_service.chat_completion(
            "code_model", [{"role": "user", "content": "ping"}]
        )
    )

    assert attempted_models == [
        "deepseek/deepseek-chat",
        "dashscope/qwen-turbo",
    ]
    assert result.content == "fallback ok"
    assert result.model_name == "dashscope/qwen-turbo"
    assert result.provider == "qwen"
    assert result.usage.total_tokens == 5
    assert result.fallback_used is True


def test_chat_completion_returns_standard_error_after_all_attempts(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = _settings(
        deepseek_api_key="unit-test-deepseek-key",
        qwen_api_key="unit-test-qwen-key",
    )

    async def failing_acompletion(**_kwargs):
        raise RuntimeError("provider unavailable")

    monkeypatch.setattr(litellm_service, "get_settings", lambda: settings)
    monkeypatch.setattr(
        litellm_service, "_import_acompletion", lambda: failing_acompletion
    )
    litellm_service.clear_model_config_cache()

    with pytest.raises(litellm_service.ModelCallError) as error:
        asyncio.run(
            litellm_service.chat_completion(
                "code_model", [{"role": "user", "content": "ping"}]
            )
        )

    standard_error = error.value.as_dict()
    assert standard_error["type"] == "model_call_failed"
    assert standard_error["requested_model"] == "code_model"
    assert [item["model_name"] for item in standard_error["attempts"]] == [
        "deepseek/deepseek-chat",
        "dashscope/qwen-turbo",
    ]


def test_chat_completion_times_out_slow_provider(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = _settings(
        deepseek_api_key="unit-test-deepseek-key",
        qwen_api_key="unit-test-qwen-key",
        model_request_timeout_seconds=0.01,
    )

    async def slow_acompletion(**_kwargs):
        await asyncio.sleep(1)

    monkeypatch.setattr(litellm_service, "get_settings", lambda: settings)
    monkeypatch.setattr(
        litellm_service, "_import_acompletion", lambda: slow_acompletion
    )
    litellm_service.clear_model_config_cache()

    with pytest.raises(litellm_service.ModelCallError) as error:
        asyncio.run(
            litellm_service.chat_completion(
                "code_model", [{"role": "user", "content": "ping"}]
            )
        )

    attempts = error.value.as_dict()["attempts"]
    assert attempts[0]["message"] == "Provider request timed out after 0.01s"


def test_settings_load_deepseek_key_from_env_file(tmp_path: Path) -> None:
    env_path = tmp_path / ".env"
    env_path.write_text(
        "DEEPSEEK_API_KEY=unit-test-deepseek-key\n",
        encoding="utf-8",
    )

    settings = Settings(_env_file=env_path)

    assert settings.deepseek_api_key is not None
    assert settings.deepseek_api_key.get_secret_value() == "unit-test-deepseek-key"


def test_chat_completion_resolves_custom_model_from_db_dict(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = _settings(deepseek_api_key="unit-test-deepseek-key")
    captured: dict = {}

    async def fake_acompletion(**kwargs):
        captured.update(kwargs)
        return {
            "choices": [{"message": {"content": "custom pong"}}],
            "usage": {"prompt_tokens": 4, "completion_tokens": 2},
        }

    monkeypatch.setattr(litellm_service, "get_settings", lambda: settings)
    monkeypatch.setattr(
        litellm_service, "_import_acompletion", lambda: fake_acompletion
    )
    litellm_service.clear_model_config_cache()

    custom_models = {
        "custom_analyst": {
            "provider": "deepseek",
            "model": "deepseek-chat",
            "purpose": "",
            "fallback_model": None,
        }
    }

    result = asyncio.run(
        litellm_service.chat_completion(
            "custom_analyst",
            [{"role": "user", "content": "analyze"}],
            temperature=0.2,
            custom_models=custom_models,
        )
    )

    assert result.content == "custom pong"
    assert result.model_name == "deepseek/deepseek-chat"
    assert result.provider == "deepseek"
    assert result.requested_model == "custom_analyst"
    assert result.usage.total_tokens == 6
    assert result.fallback_used is False
    assert captured["model"] == "deepseek/deepseek-chat"
    assert captured["temperature"] == 0.2
    assert captured["api_key"] == "unit-test-deepseek-key"


def test_chat_completion_does_not_override_yaml_config_with_custom_model(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = _settings(deepseek_api_key="unit-test-deepseek-key")
    captured: dict = {}

    async def fake_acompletion(**kwargs):
        captured.update(kwargs)
        return {
            "choices": [{"message": {"content": "yaml pong"}}],
            "usage": {"prompt_tokens": 4, "completion_tokens": 2},
        }

    monkeypatch.setattr(litellm_service, "get_settings", lambda: settings)
    monkeypatch.setattr(
        litellm_service, "_import_acompletion", lambda: fake_acompletion
    )
    litellm_service.clear_model_config_cache()

    custom_models = {
        "code_model": {
            "provider": "openai",
            "model": "gpt-4o",
            "purpose": "试图覆盖 YAML 配置",
            "fallback_model": None,
        }
    }

    result = asyncio.run(
        litellm_service.chat_completion(
            "code_model",
            [{"role": "user", "content": "ping"}],
            custom_models=custom_models,
        )
    )

    # YAML config wins; the custom openai/gpt-4o must not replace it.
    assert result.model_name == "deepseek/deepseek-chat"
    assert result.provider == "deepseek"
    assert captured["model"] == "deepseek/deepseek-chat"
