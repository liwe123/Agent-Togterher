from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.errors import AppError
from app.core.config import get_settings
from app.db.session import get_db
from app.models import Agent, Workspace
from app.schemas import (
    ErrorResponse,
    ModelConfigInfo,
    ModelInfo,
    ModelTestRequest,
    ModelTestResult,
    ModelTokenUsage,
    ProviderStatusInfo,
    SuccessResponse,
)
from app.services import litellm_service
from app.websocket import create_event, websocket_manager

router = APIRouter(prefix="/models", tags=["models"])


def _provider_for(model_name: str) -> str:
    if "/" in model_name:
        return model_name.split("/", maxsplit=1)[0]
    return "unknown"


def _provider_is_configured(provider: str) -> bool:
    return litellm_service.is_provider_configured(provider)


@router.get("", response_model=SuccessResponse[list[ModelInfo]])
async def list_models(
    session: AsyncSession = Depends(get_db),
) -> SuccessResponse[list[ModelInfo]]:
    configured_default = get_settings().litellm_default_model.strip()
    agent_model_names = set(
        await session.scalars(select(Agent.model_name).distinct())
    )
    agent_model_names.add(configured_default or "openai/gpt-4.1-mini")
    models_by_name = {
        name: ModelInfo(
            name=name,
            provider=_provider_for(name),
            configured=_provider_is_configured(_provider_for(name)),
        )
        for name in agent_model_names
        if name
    }
    for alias, config in litellm_service.get_model_configs().items():
        models_by_name[alias] = ModelInfo(
            name=alias,
            provider=config.provider,
            configured=_provider_is_configured(config.provider),
        )
    models = [
        models_by_name[name]
        for name in sorted(models_by_name)
    ]
    return SuccessResponse(data=models)


# -- Providers whose key configuration status we expose ----------------------
_KNOWN_PROVIDERS = ("openai", "anthropic", "gemini", "deepseek", "qwen")


@router.get("/config", response_model=SuccessResponse[list[ModelConfigInfo]])
async def get_model_config() -> SuccessResponse[list[ModelConfigInfo]]:
    """Return model role configurations from models.yaml (no API keys)."""
    configs = litellm_service.get_model_configs()
    items = [
        ModelConfigInfo(
            name=cfg.name,
            provider=cfg.provider,
            model=cfg.model,
            purpose=cfg.purpose,
            fallback_model=cfg.fallback_model,
        )
        for cfg in configs.values()
    ]
    return SuccessResponse(data=items)


@router.get(
    "/providers/status",
    response_model=SuccessResponse[list[ProviderStatusInfo]],
)
async def get_providers_status(
    session: AsyncSession = Depends(get_db),
) -> SuccessResponse[list[ProviderStatusInfo]]:
    """Return API-key configuration status per provider (never the key)."""
    # Collect providers from YAML + a fixed list so the UI always shows all.
    configs = litellm_service.get_model_configs()
    providers: dict[str, bool] = {p: False for p in _KNOWN_PROVIDERS}
    for cfg in configs.values():
        p = cfg.provider.strip().lower()
        providers.setdefault(p, False)
    for p in list(providers):
        providers[p] = await litellm_service.is_provider_configured_async(p, session=session)
    items = [
        ProviderStatusInfo(provider=p, configured=c)
        for p, c in providers.items()
    ]
    return SuccessResponse(data=items)


@router.post(
    "/test",
    response_model=SuccessResponse[ModelTestResult],
    responses={
        502: {"model": ErrorResponse, "description": "Provider request failed"},
        503: {"model": ErrorResponse, "description": "LiteLLM unavailable"},
    },
)
async def test_model(
    payload: ModelTestRequest,
    session: AsyncSession = Depends(get_db),
) -> SuccessResponse[ModelTestResult]:
    if (
        payload.workspace_id is not None
        and await session.get(Workspace, payload.workspace_id) is None
    ):
        raise AppError(404, "Workspace not found")
    try:
        db_api_keys = await litellm_service.get_db_api_keys(session)
        completion = await litellm_service.chat_completion(
            payload.model_name,
            [{"role": "user", "content": payload.prompt}],
            api_keys=db_api_keys,
        )
    except litellm_service.ModelConfigurationError as exc:
        raise AppError(422, str(exc)) from exc
    except litellm_service.LiteLLMUnavailableError as exc:
        if payload.workspace_id is not None:
            await websocket_manager.broadcast_to_workspace(
                payload.workspace_id,
                create_event("error", {"message": str(exc)}),
            )
        raise AppError(503, str(exc)) from exc
    except litellm_service.ModelCallError as exc:
        message = f"Model test failed: {exc}"
        if payload.workspace_id is not None:
            await websocket_manager.broadcast_to_workspace(
                payload.workspace_id,
                create_event("error", {"message": message}),
            )
        raise AppError(502, message) from exc
    result = ModelTestResult(
        requested_model=completion.requested_model,
        model_name=completion.model_name,
        provider=completion.provider,
        content=completion.content,
        response=completion.content,
        usage=ModelTokenUsage(
            prompt_tokens=completion.usage.prompt_tokens,
            completion_tokens=completion.usage.completion_tokens,
            total_tokens=completion.usage.total_tokens,
        ),
        latency_ms=completion.latency_ms,
        fallback_used=completion.fallback_used,
    )
    if payload.workspace_id is not None:
        await websocket_manager.broadcast_to_workspace(
            payload.workspace_id,
            create_event("model.call_finished", result),
        )
    return SuccessResponse(data=result)
