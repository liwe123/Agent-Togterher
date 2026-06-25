from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.errors import AppError
from app.api.persistence import commit_or_conflict
from app.db.session import get_db
from app.models import Conversation, Workspace
from app.schemas import ConversationCreate, ConversationRead, SuccessResponse

router = APIRouter(prefix="/conversations", tags=["conversations"])


@router.get("", response_model=SuccessResponse[list[ConversationRead]])
async def list_conversations(
    workspace_id: int | None = Query(default=None, gt=0),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    session: AsyncSession = Depends(get_db),
) -> SuccessResponse[list[ConversationRead]]:
    statement = select(Conversation)
    if workspace_id is not None:
        statement = statement.where(Conversation.workspace_id == workspace_id)
    conversations = (
        await session.scalars(
            statement.order_by(Conversation.id.desc()).offset(offset).limit(limit)
        )
    ).all()
    return SuccessResponse(data=list(conversations))


@router.post(
    "",
    response_model=SuccessResponse[ConversationRead],
    status_code=status.HTTP_201_CREATED,
)
async def create_conversation(
    payload: ConversationCreate,
    session: AsyncSession = Depends(get_db),
) -> SuccessResponse[ConversationRead]:
    if await session.get(Workspace, payload.workspace_id) is None:
        raise AppError(404, "Workspace not found")
    conversation = Conversation(**payload.model_dump())
    session.add(conversation)
    await commit_or_conflict(session)
    await session.refresh(conversation)
    return SuccessResponse(data=conversation)


@router.get(
    "/{conversation_id}", response_model=SuccessResponse[ConversationRead]
)
async def get_conversation(
    conversation_id: int,
    session: AsyncSession = Depends(get_db),
) -> SuccessResponse[ConversationRead]:
    conversation = await session.get(Conversation, conversation_id)
    if conversation is None:
        raise AppError(404, "Conversation not found")
    return SuccessResponse(data=conversation)
