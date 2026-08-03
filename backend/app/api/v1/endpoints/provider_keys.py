from fastapi import APIRouter, Depends, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.api.errors import AppError
from app.db.session import get_db
from app.models import ProviderCredential
from app.schemas import (
    ProviderKeyUpsert,
    ProviderKeyValue,
    SuccessResponse,
    ProviderStatusInfo,
)
from app.services import litellm_service

router = APIRouter(prefix="/provider-keys", tags=["provider-keys"])

_PROVIDERS = ["openai", "anthropic", "gemini", "deepseek", "qwen", "dashscope"]


@router.get("", response_model=SuccessResponse[list[ProviderStatusInfo]])
async def list_provider_keys(session: AsyncSession = Depends(get_db)):
    """Return which providers have keys configured (DB or env). Never exposes key values."""
    rows = (await session.execute(select(ProviderCredential))).scalars().all()
    db_configured = {row.provider for row in rows}
    result = []
    for provider in _PROVIDERS:
        configured = provider in db_configured or litellm_service.is_provider_configured(provider)
        result.append(ProviderStatusInfo(provider=provider, configured=configured))
    return SuccessResponse(data=result)


@router.get("/{provider}", response_model=SuccessResponse[ProviderKeyValue])
async def get_provider_key(provider: str, session: AsyncSession = Depends(get_db)):
    """Return a provider's stored key value (DB first, then env).

    Intended for explicit user-triggered reveal in this local-first tool.
    The list endpoint still never exposes key values.
    """
    if provider not in _PROVIDERS:
        raise AppError(422, f"Unknown provider '{provider}'. Supported: {', '.join(_PROVIDERS)}")
    row = (await session.execute(
        select(ProviderCredential).where(ProviderCredential.provider == provider)
    )).scalar_one_or_none()
    if row is not None and row.api_key.strip():
        return SuccessResponse(data=ProviderKeyValue(provider=provider, configured=True, api_key=row.api_key))
    env_key = litellm_service.get_api_key_value(provider)
    if env_key:
        return SuccessResponse(data=ProviderKeyValue(provider=provider, configured=True, api_key=env_key))
    return SuccessResponse(data=ProviderKeyValue(provider=provider, configured=False, api_key=None))


@router.put("/{provider}", status_code=status.HTTP_200_OK, response_model=SuccessResponse[ProviderStatusInfo])
async def upsert_provider_key(provider: str, payload: ProviderKeyUpsert, session: AsyncSession = Depends(get_db)):
    """Store an API key for a provider. Overwrites if already exists."""
    if provider not in _PROVIDERS:
        raise AppError(422, f"Unknown provider '{provider}'. Supported: {', '.join(_PROVIDERS)}")
    key = payload.api_key.strip()
    if not key:
        raise AppError(422, "API key cannot be empty")
    row = (await session.execute(
        select(ProviderCredential).where(ProviderCredential.provider == provider)
    )).scalar_one_or_none()
    if row is None:
        row = ProviderCredential(provider=provider, api_key=key)
        session.add(row)
    else:
        row.api_key = key
    await session.commit()
    await session.refresh(row)
    return SuccessResponse(data=ProviderStatusInfo(provider=provider, configured=True))


@router.delete("/{provider}", response_model=SuccessResponse[ProviderStatusInfo])
async def delete_provider_key(provider: str, session: AsyncSession = Depends(get_db)):
    """Remove a stored API key for a provider."""
    row = (await session.execute(
        select(ProviderCredential).where(ProviderCredential.provider == provider)
    )).scalar_one_or_none()
    if row is None:
        return SuccessResponse(data=ProviderStatusInfo(provider=provider, configured=litellm_service.is_provider_configured(provider)))
    await session.delete(row)
    await session.commit()
    return SuccessResponse(data=ProviderStatusInfo(provider=provider, configured=litellm_service.is_provider_configured(provider)))
