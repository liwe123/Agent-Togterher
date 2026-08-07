from fastapi import APIRouter, Depends, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.api.errors import AppError
from app.api.persistence import commit_or_conflict
from app.db.session import get_db
from app.models import Agent, CustomModelConfig
from app.schemas import CustomModelCreate, CustomModelRead, SuccessResponse

router = APIRouter(prefix="/custom-models", tags=["custom-models"])

@router.get("", response_model=SuccessResponse[list[CustomModelRead]])
async def list_custom_models(session: AsyncSession = Depends(get_db)):
    rows = (await session.execute(select(CustomModelConfig).order_by(CustomModelConfig.id))).scalars().all()
    return SuccessResponse(data=[CustomModelRead.model_validate(r) for r in rows])

@router.post("", status_code=status.HTTP_201_CREATED, response_model=SuccessResponse[CustomModelRead])
async def create_custom_model(payload: CustomModelCreate, session: AsyncSession = Depends(get_db)):
    existing = (
        await session.execute(
            select(CustomModelConfig).where(CustomModelConfig.name == payload.name)
        )
    ).scalar_one_or_none()
    if existing is not None:
        raise AppError(409, f"Custom model '{payload.name}' already exists")
    cfg = CustomModelConfig(**payload.model_dump())
    session.add(cfg)
    await commit_or_conflict(session, f"Model name '{payload.name}' already exists")
    await session.refresh(cfg)
    return SuccessResponse(data=CustomModelRead.model_validate(cfg))

@router.delete("/{name}", response_model=SuccessResponse[dict])
async def delete_custom_model(name: str, session: AsyncSession = Depends(get_db)):
    cfg = (
        await session.execute(
            select(CustomModelConfig).where(CustomModelConfig.name == name)
        )
    ).scalar_one_or_none()
    if cfg is None:
        raise AppError(404, f"Custom model '{name}' not found")
    referencing_agent = await session.scalar(select(Agent).where(Agent.model_name == name))
    fallback_reference = await session.scalar(
        select(CustomModelConfig).where(CustomModelConfig.fallback_model == name)
    )
    if referencing_agent is not None or fallback_reference is not None:
        raise AppError(409, f"Custom model '{name}' is still referenced")
    await session.delete(cfg)
    await session.commit()
    return SuccessResponse(data={"deleted": name})
