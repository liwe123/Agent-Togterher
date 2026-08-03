from __future__ import annotations

import logging
import asyncio
import re
from collections.abc import Awaitable, Callable, Mapping, Sequence
from dataclasses import dataclass
from decimal import Decimal
from functools import lru_cache
from pathlib import Path
from time import perf_counter
from typing import Any

import yaml
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from app.core.config import Settings, get_settings

logger = logging.getLogger(__name__)

Message = Mapping[str, Any]
CompletionCallable = Callable[..., Awaitable[Any]]


@dataclass(frozen=True)
class TokenUsage:
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0


@dataclass(frozen=True)
class ChatCompletionResult:
    content: str
    usage: TokenUsage
    provider: str
    model_name: str
    requested_model: str
    latency_ms: int
    fallback_used: bool
    cost: Decimal = Decimal("0")


@dataclass(frozen=True)
class ModelAttemptFailure:
    provider: str
    model_name: str
    message: str
    latency_ms: int = 0


class LiteLLMServiceError(Exception):
    """Base class for errors safe to expose through the API layer."""

    error_type = "litellm_service_error"

    def as_dict(self) -> dict[str, Any]:
        return {"type": self.error_type, "message": str(self)}


class LiteLLMUnavailableError(LiteLLMServiceError):
    error_type = "litellm_unavailable"


class ModelConfigurationError(LiteLLMServiceError):
    error_type = "model_configuration_error"


class ModelCallError(LiteLLMServiceError):
    error_type = "model_call_failed"

    def __init__(
        self,
        requested_model: str,
        attempts: Sequence[ModelAttemptFailure],
        latency_ms: int | None = None,
    ) -> None:
        self.requested_model = requested_model
        self.attempts = tuple(attempts)
        self.latency_ms = (
            latency_ms
            if latency_ms is not None
            else sum(attempt.latency_ms for attempt in attempts)
        )
        summary = "; ".join(
            f"{attempt.model_name}: {attempt.message}" for attempt in attempts
        )
        super().__init__(
            f"All attempts for '{requested_model}' failed"
            + (f" ({summary})" if summary else "")
        )

    def as_dict(self) -> dict[str, Any]:
        value = super().as_dict()
        value["requested_model"] = self.requested_model
        value["latency_ms"] = self.latency_ms
        value["attempts"] = [
            {
                "provider": attempt.provider,
                "model_name": attempt.model_name,
                "message": attempt.message,
                "latency_ms": attempt.latency_ms,
            }
            for attempt in self.attempts
        ]
        return value


class ModelConfig(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    name: str = Field(min_length=1, max_length=100)
    provider: str = Field(min_length=1, max_length=100)
    model: str = Field(min_length=1, max_length=255)
    purpose: str = Field(min_length=1, max_length=500)
    fallback_model: str | None = Field(default=None, max_length=255)


class ModelsConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    models: dict[str, ModelConfig]


@dataclass(frozen=True)
class ResolvedModel:
    reference: str
    provider: str
    model_name: str
    fallback_model: str | None


_PROVIDER_PREFIXES = {
    "anthropic": "anthropic",
    "claude": "anthropic",
    "deepseek": "deepseek",
    "gemini": "gemini",
    "google": "gemini",
    "openai": "openai",
    "qwen": "dashscope",
    "dashscope": "dashscope",
}

_PROVIDER_KEY_FIELDS: dict[str, tuple[str, ...]] = {
    "openai": ("openai_api_key",),
    "anthropic": ("anthropic_api_key",),
    "claude": ("anthropic_api_key",),
    "gemini": ("gemini_api_key",),
    "google": ("gemini_api_key",),
    "deepseek": ("deepseek_api_key",),
    "qwen": ("qwen_api_key", "dashscope_api_key"),
    "dashscope": ("dashscope_api_key", "qwen_api_key"),
}

_SECRET_PATTERNS = (
    re.compile(r"\bsk-[A-Za-z0-9_-]{8,}\b"),
    re.compile(r"\b[A-Za-z0-9_-]{32,}\b"),
)


def _config_path() -> Path:
    configured = get_settings().models_config_path.strip()
    candidates: list[Path] = []
    if configured:
        path = Path(configured).expanduser()
        if path.is_absolute():
            candidates.append(path)
        else:
            candidates.extend(
                [
                    Path.cwd() / path,
                    Path(__file__).resolve().parents[2] / path,
                    Path(__file__).resolve().parents[3] / path,
                ]
            )
    else:
        candidates.extend(
            [
                Path.cwd() / "config" / "models.yaml",
                Path(__file__).resolve().parents[2] / "config" / "models.yaml",
                Path(__file__).resolve().parents[3] / "config" / "models.yaml",
            ]
        )

    for candidate in candidates:
        if candidate.is_file():
            return candidate.resolve()

    expected = candidates[0] if candidates else Path("config/models.yaml")
    raise ModelConfigurationError(f"Model config file not found: {expected}")


@lru_cache(maxsize=8)
def _load_model_configs(path: str) -> dict[str, ModelConfig]:
    try:
        raw_config = yaml.safe_load(Path(path).read_text(encoding="utf-8"))
        config = ModelsConfig.model_validate(raw_config)
    except (OSError, yaml.YAMLError, ValidationError, TypeError) as exc:
        raise ModelConfigurationError(
            f"Invalid model config: {_sanitize_error_message(exc)}"
        ) from exc

    for alias, model in config.models.items():
        if alias != model.name:
            raise ModelConfigurationError(
                f"Model config key '{alias}' must match name '{model.name}'"
            )
    return config.models


def get_model_configs() -> dict[str, ModelConfig]:
    """Load and validate configured model aliases."""
    return _load_model_configs(str(_config_path())).copy()


def clear_model_config_cache() -> None:
    """Clear cached YAML data, primarily for tests and config reloads."""
    _load_model_configs.cache_clear()


def _normalize_provider(provider: str) -> str:
    return provider.strip().lower()


def _model_name_for_litellm(provider: str, model: str) -> str:
    if "/" in model:
        return model
    prefix = _PROVIDER_PREFIXES.get(_normalize_provider(provider), provider.lower())
    return f"{prefix}/{model}"


def _resolve_model(reference: str, configs: Mapping[str, ModelConfig]) -> ResolvedModel:
    configured = configs.get(reference)
    if configured is not None:
        return ResolvedModel(
            reference=reference,
            provider=_normalize_provider(configured.provider),
            model_name=_model_name_for_litellm(
                configured.provider, configured.model
            ),
            fallback_model=configured.fallback_model,
        )

    if "/" not in reference:
        raise ModelConfigurationError(
            f"Unknown model alias '{reference}'; use a configured alias or provider/model"
        )
    provider = _normalize_provider(reference.split("/", maxsplit=1)[0])
    return ResolvedModel(
        reference=reference,
        provider=provider,
        model_name=reference,
        fallback_model=None,
    )


def _fallback_chain(
    requested_model: str,
    configs: Mapping[str, ModelConfig],
) -> list[ResolvedModel]:
    chain: list[ResolvedModel] = []
    seen_references: set[str] = set()
    reference: str | None = requested_model

    while reference is not None:
        if reference in seen_references:
            raise ModelConfigurationError(
                f"Fallback cycle detected at model '{reference}'"
            )
        seen_references.add(reference)
        resolved = _resolve_model(reference, configs)
        chain.append(resolved)
        reference = resolved.fallback_model

    return chain


def _get_api_key(provider: str, settings: Settings | None = None) -> str | None:
    settings = settings or get_settings()
    for field_name in _PROVIDER_KEY_FIELDS.get(_normalize_provider(provider), ()):
        secret = getattr(settings, field_name, None)
        if secret is None:
            continue
        value = secret.get_secret_value().strip()
        if value:
            return value
    return None


def is_provider_configured(provider: str) -> bool:
    """Return credential presence without exposing the credential value."""
    return _get_api_key(provider) is not None


def get_api_key_value(provider: str) -> str | None:
    """Return the env-configured key value for a provider.

    Used only for explicit, user-triggered reveal in this local-first tool.
    Prefer `is_provider_configured` for presence checks.
    """
    return _get_api_key(provider)


async def get_db_api_keys(session) -> dict[str, str]:
    """Load all provider API keys stored in the database."""
    from app.models import ProviderCredential
    from sqlalchemy import select as sa_select
    rows = (await session.execute(sa_select(ProviderCredential))).scalars().all()
    return {row.provider: row.api_key for row in rows}


async def get_db_custom_models(session) -> dict[str, dict]:
    """Load custom model configs from DB into a dict for chat_completion."""
    from app.models import CustomModelConfig
    from sqlalchemy import select
    rows = (await session.execute(select(CustomModelConfig))).scalars().all()
    return {
        row.name: {
            "provider": row.provider,
            "model": row.model,
            "purpose": row.purpose,
            "fallback_model": row.fallback_model,
        }
        for row in rows
    }


async def is_provider_configured_async(provider: str, session=None) -> bool:
    """Return whether a provider has an API key (DB or env)."""
    if session is not None:
        from app.models import ProviderCredential
        from sqlalchemy import select as sa_select
        row = (await session.execute(
            sa_select(ProviderCredential).where(ProviderCredential.provider == provider)
        )).scalar_one_or_none()
        if row is not None and row.api_key.strip():
            return True
    return is_provider_configured(provider)


def _import_acompletion() -> CompletionCallable:
    try:
        from litellm import acompletion
    except ImportError as exc:
        raise LiteLLMUnavailableError(
            "LiteLLM is not installed in the backend environment"
        ) from exc
    return acompletion


def _validate_request(messages: Sequence[Message], temperature: float) -> None:
    if not messages:
        raise ModelConfigurationError("messages must contain at least one message")
    if not 0 <= temperature <= 2:
        raise ModelConfigurationError("temperature must be between 0 and 2")
    for index, message in enumerate(messages):
        if not isinstance(message, Mapping):
            raise ModelConfigurationError(f"messages[{index}] must be an object")
        if not str(message.get("role", "")).strip():
            raise ModelConfigurationError(f"messages[{index}].role is required")
        if "content" not in message:
            raise ModelConfigurationError(f"messages[{index}].content is required")


def _value(container: Any, name: str, default: Any = None) -> Any:
    if isinstance(container, Mapping):
        return container.get(name, default)
    return getattr(container, name, default)


def _extract_result(response: Any) -> tuple[str, TokenUsage, Decimal]:
    choices = _value(response, "choices", [])
    if not choices:
        raise ValueError("Provider response did not contain choices")
    message = _value(choices[0], "message")
    content = _value(message, "content", "")
    if isinstance(content, str):
        normalized_content = content
    elif content is None:
        normalized_content = ""
    else:
        normalized_content = str(content)

    usage = _value(response, "usage", {}) or {}
    prompt_tokens = int(_value(usage, "prompt_tokens", 0) or 0)
    completion_tokens = int(_value(usage, "completion_tokens", 0) or 0)
    total_tokens = int(
        _value(usage, "total_tokens", prompt_tokens + completion_tokens)
        or prompt_tokens + completion_tokens
    )
    cost = _extract_cost(response)
    return normalized_content, TokenUsage(
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        total_tokens=total_tokens,
    ), cost


def _extract_cost(response: Any) -> Decimal:
    """Extract cost from LiteLLM response, defaulting to 0."""
    usage = _value(response, "usage", {}) or {}
    cost = _value(usage, "cost", None)
    if cost is not None:
        return Decimal(str(cost))
    # Try response-level cost
    cost = _value(response, "cost", None)
    if cost is not None:
        return Decimal(str(cost))
    return Decimal("0")


def _sanitize_error_message(error: BaseException) -> str:
    message = str(error).strip() or error.__class__.__name__
    settings = get_settings()
    checked_fields = {
        field for fields in _PROVIDER_KEY_FIELDS.values() for field in fields
    }
    for field_name in checked_fields:
        secret = getattr(settings, field_name, None)
        if secret is not None:
            value = secret.get_secret_value()
            if value:
                message = message.replace(value, "[REDACTED]")
    for pattern in _SECRET_PATTERNS:
        message = pattern.sub("[REDACTED]", message)
    return message[:500]


async def chat_completion(
    model_name: str,
    messages: Sequence[Message],
    temperature: float = 0.7,
    api_keys: dict[str, str] | None = None,
    custom_models: dict[str, dict] | None = None,
) -> ChatCompletionResult:
    """Call a configured LiteLLM model, falling back on provider failures."""
    requested_model = model_name.strip()
    if not requested_model:
        raise ModelConfigurationError("model_name is required")
    _validate_request(messages, temperature)

    configs = get_model_configs()
    if custom_models:
        for alias, cfg in custom_models.items():
            if alias in configs:
                continue
            configs[alias] = ModelConfig(
                name=alias,
                provider=cfg["provider"],
                model=cfg["model"],
                purpose=cfg.get("purpose") or alias,
                fallback_model=cfg.get("fallback_model"),
            )
    chain = _fallback_chain(requested_model, configs)
    acompletion = _import_acompletion()
    timeout_seconds = get_settings().model_request_timeout_seconds
    failures: list[ModelAttemptFailure] = []
    started_at = perf_counter()

    for attempt_index, model in enumerate(chain):
        # Check DB keys first, then env
        api_key = None
        if api_keys:
            api_key = api_keys.get(model.provider)
        if api_key is None:
            api_key = _get_api_key(model.provider)
        attempt_started_at = perf_counter()
        try:
            if model.provider in _PROVIDER_KEY_FIELDS and api_key is None:
                raise RuntimeError(
                    f"API key is not configured for provider '{model.provider}'"
                )

            kwargs: dict[str, Any] = {
                "model": model.model_name,
                "messages": [dict(message) for message in messages],
                "temperature": temperature,
            }
            if api_key is not None:
                kwargs["api_key"] = api_key

            try:
                response = await asyncio.wait_for(
                    acompletion(**kwargs),
                    timeout=timeout_seconds,
                )
            except TimeoutError as exc:
                raise RuntimeError(
                    f"Provider request timed out after {timeout_seconds:g}s"
                ) from exc
            content, usage, cost = _extract_result(response)
            latency_ms = round((perf_counter() - started_at) * 1000)
            logger.info(
                "LiteLLM call succeeded provider=%s model=%s latency_ms=%d fallback=%s",
                model.provider,
                model.model_name,
                latency_ms,
                attempt_index > 0,
            )
            return ChatCompletionResult(
                content=content,
                usage=usage,
                provider=model.provider,
                model_name=model.model_name,
                requested_model=requested_model,
                latency_ms=latency_ms,
                fallback_used=attempt_index > 0,
                cost=cost,
            )
        except Exception as exc:
            message = _sanitize_error_message(exc)
            attempt_latency_ms = round((perf_counter() - attempt_started_at) * 1000)
            failures.append(
                ModelAttemptFailure(
                    provider=model.provider,
                    model_name=model.model_name,
                    message=message,
                    latency_ms=attempt_latency_ms,
                )
            )
            logger.warning(
                "LiteLLM call failed provider=%s model=%s latency_ms=%d: %s",
                model.provider,
                model.model_name,
                attempt_latency_ms,
                message,
            )

    raise ModelCallError(
        requested_model,
        failures,
        latency_ms=round((perf_counter() - started_at) * 1000),
    )
