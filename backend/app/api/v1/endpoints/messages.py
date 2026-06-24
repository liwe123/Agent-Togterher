from fastapi import APIRouter, Depends, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.errors import AppError
from app.core.message_hub import MessageHub
from app.db.session import get_db
from app.models import Conversation, Message
from app.schemas import MessageCreate, MessageHubRead, MessageRead, SuccessResponse

router = APIRouter(prefix="/conversations/{conversation_id}/messages", tags=["messages"])


async def _get_conversation(session: AsyncSession, conversation_id: int) -> Conversation:
    conversation = await session.get(Conversation, conversation_id)
    if conversation is None:
        raise AppError(404, "Conversation not found")
    return conversation


@router.get("", response_model=SuccessResponse[list[MessageRead]])
async def list_messages(
    conversation_id: int,
    session: AsyncSession = Depends(get_db),
) -> SuccessResponse[list[MessageRead]]:
    await _get_conversation(session, conversation_id)
    messages = (
        await session.scalars(
            select(Message)
            .where(Message.conversation_id == conversation_id)
            .order_by(Message.id)
        )
    ).all()
    return SuccessResponse(data=list(messages))


@router.post(
    "",
    response_model=SuccessResponse[MessageHubRead | MessageRead],
    status_code=status.HTTP_201_CREATED,
)
async def create_message(
    conversation_id: int,
    payload: MessageCreate,
    session: AsyncSession = Depends(get_db),
) -> SuccessResponse[MessageHubRead | MessageRead]:
    result = await MessageHub(session).receive_message(conversation_id, payload)
    return SuccessResponse(data=result)
