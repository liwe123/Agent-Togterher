from fastapi import APIRouter, Depends, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.errors import AppError
from app.db.session import get_db
from app.models import ProviderCredential
from app.schemas import ProviderKeyUpsert, ProviderKeyValue, ProviderStatusInfo, SuccessResponse
from app.services import litellm_service

router = APIRouter(prefix="/provider-keys", tags=["provider-keys"])

_PRESET_PROVIDERS = ["deepseek"]
_PROVIDER_NAME_MAX_LENGTH = 50


def _canonical_provider(provider: str) -> str:
    return litellm_service.normalize_provider(provider)


async def _load_provider_rows(session: AsyncSession) -> list[ProviderCredential]:
    return (await session.execute(select(ProviderCredential).order_by(ProviderCredential.id))).scalars().all()


@router.get("", response_model=SuccessResponse[list[ProviderStatusInfo]])
async def list_provider_keys(session: AsyncSession = Depends(get_db)):
    """Return which providers have keys configured (DB or env). Never exposes key values."""
    rows = await _load_provider_rows(session)
    db_configured = {_canonical_provider(row.provider) for row in rows if row.api_key.strip()}

    result: list[ProviderStatusInfo] = []
    seen: set[str] = set()

    for provider in _PRESET_PROVIDERS:
        canonical_provider = _canonical_provider(provider)
        seen.add(canonical_provider)
        configured = canonical_provider in db_configured or litellm_service.is_provider_configured(canonical_provider)
        result.append(ProviderStatusInfo(provider=canonical_provider, configured=configured))

    for row in rows:
        canonical_provider = _canonical_provider(row.provider)
        if canonical_provider in seen:
            continue
        seen.add(canonical_provider)
        result.append(ProviderStatusInfo(provider=canonical_provider, configured=True))

    return SuccessResponse(data=result)


@router.get("/{provider}", response_model=SuccessResponse[ProviderKeyValue])
async def get_provider_key(provider: str, session: AsyncSession = Depends(get_db)):
    """Return a provider's stored key value (DB first, then env).

    Intended for explicit user-triggered reveal in this local-first tool.
    The list endpoint still never exposes key values.
    """
    canonical_provider = _canonical_provider(provider)
    rows = await _load_provider_rows(session)
    row = next(
        (item for item in rows if _canonical_provider(item.provider) == canonical_provider),
        None,
    )
    if row is not None and row.api_key.strip():
        return SuccessResponse(
            data=ProviderKeyValue(
                provider=canonical_provider,
                configured=True,
                api_key=row.api_key,
            )
        )
    env_key = litellm_service.get_api_key_value(canonical_provider)
    if env_key:
        return SuccessResponse(
            data=ProviderKeyValue(
                provider=canonical_provider,
                configured=True,
                api_key=env_key,
            )
        )
    return SuccessResponse(
        data=ProviderKeyValue(provider=canonical_provider, configured=False, api_key=None)
    )


@router.put("/{provider}", status_code=status.HTTP_200_OK, response_model=SuccessResponse[ProviderStatusInfo])
async def upsert_provider_key(
    provider: str,
    payload: ProviderKeyUpsert,
    session: AsyncSession = Depends(get_db),
):
    """Store an API key for any provider. Overwrites if already exists."""
    canonical_provider = _canonical_provider(provider)
    if not canonical_provider:
        raise AppError(422, "Provider name cannot be empty")
    if len(canonical_provider) > _PROVIDER_NAME_MAX_LENGTH:
        raise AppError(
            422,
            f"Provider name must be {_PROVIDER_NAME_MAX_LENGTH} characters or fewer",
        )

    key = payload.api_key.strip()
    if not key:
        raise AppError(422, "API key cannot be empty")

    rows = await _load_provider_rows(session)
    row = next(
        (item for item in rows if _canonical_provider(item.provider) == canonical_provider),
        None,
    )
    if row is None:
        row = ProviderCredential(provider=canonical_provider, api_key=key)
        session.add(row)
    else:
        row.provider = canonical_provider
        row.api_key = key

    await session.commit()
    await session.refresh(row)
    return SuccessResponse(data=ProviderStatusInfo(provider=canonical_provider, configured=True))


@router.delete("/{provider}", response_model=SuccessResponse[ProviderStatusInfo])
async def delete_provider_key(provider: str, session: AsyncSession = Depends(get_db)):
    """Remove a stored API key for a provider."""
    canonical_provider = _canonical_provider(provider)
    rows = await _load_provider_rows(session)
    row = next(
        (item for item in rows if _canonical_provider(item.provider) == canonical_provider),
        None,
    )
    if row is None:
        return SuccessResponse(
            data=ProviderStatusInfo(
                provider=canonical_provider,
                configured=litellm_service.is_provider_configured(canonical_provider),
            )
        )

    await session.delete(row)
    await session.commit()
    return SuccessResponse(
        data=ProviderStatusInfo(
            provider=canonical_provider,
            configured=litellm_service.is_provider_configured(canonical_provider),
        )
    )
