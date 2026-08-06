from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.errors import AppError


async def commit_or_conflict(
    session: AsyncSession, message: str = "Resource conflicts with existing data"
) -> None:
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise AppError(409, message) from exc
