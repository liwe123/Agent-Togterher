from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.errors import AppError
from app.api.persistence import commit_or_conflict
from app.core.orchestrator import (
    AgentOrchestrator,
    TaskNotFoundError,
    TaskNotRunnableError,
)
from app.db.session import get_db
from app.models import Agent, Conversation, Message, ModelCall, Task, TaskStep, Workspace
from app.models.enums import TaskStatus
from app.schemas import (
    ModelCallRead,
    SuccessResponse,
    TaskCreate,
    TaskDetailRead,
    TaskListItemRead,
    TaskRead,
    TaskStepRead,
    TaskTokenUsageRead,
    TaskUpdate,
)
from app.websocket import create_event, websocket_manager

router = APIRouter(prefix="/tasks", tags=["tasks"])


def _task_list_item(task: Task) -> TaskListItemRead:
    return TaskListItemRead(
        **TaskRead.model_validate(task).model_dump(),
        assigned_agent=task.assigned_agent,
    )


def _task_detail(task: Task) -> TaskDetailRead:
    steps = sorted(task.steps, key=lambda item: item.id)
    model_calls = sorted(task.model_calls, key=lambda item: item.id)
    prompt_tokens = sum(item.prompt_tokens for item in model_calls)
    completion_tokens = sum(item.completion_tokens for item in model_calls)
    started_at = min(
        (item.started_at for item in steps if item.started_at is not None),
        default=None,
    )
    finished_at = max(
        (item.finished_at for item in steps if item.finished_at is not None),
        default=None,
    )
    duration_ms = None
    has_active_step = any(
        item.started_at is not None and item.finished_at is None for item in steps
    )
    if not has_active_step and started_at is not None and finished_at is not None:
        duration_ms = max(0, int((finished_at - started_at).total_seconds() * 1000))

    return TaskDetailRead(
        **TaskRead.model_validate(task).model_dump(),
        assigned_agent=task.assigned_agent,
        original_input=task.input_message.content if task.input_message else None,
        task_steps=[TaskStepRead.model_validate(item) for item in steps],
        model_calls=[ModelCallRead.model_validate(item) for item in model_calls],
        token_usage=TaskTokenUsageRead(
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            total_tokens=prompt_tokens + completion_tokens,
        ),
        duration_ms=duration_ms,
    )


async def _validate_references(
    session: AsyncSession,
    workspace_id: int,
    conversation_id: int | None,
    assigned_agent_id: int | None,
    input_message_id: int | None,
) -> None:
    if await session.get(Workspace, workspace_id) is None:
        raise AppError(404, "Workspace not found")
    conversation = None
    if conversation_id is not None:
        conversation = await session.get(Conversation, conversation_id)
        if conversation is None or conversation.workspace_id != workspace_id:
            raise AppError(422, "Conversation must belong to the task workspace")
    if assigned_agent_id is not None:
        agent = await session.get(Agent, assigned_agent_id)
        if agent is None or agent.workspace_id != workspace_id:
            raise AppError(422, "Assigned agent must belong to the task workspace")
    if input_message_id is not None:
        message = await session.get(Message, input_message_id)
        if message is None:
            raise AppError(422, "Input message not found")
        message_conversation = await session.get(Conversation, message.conversation_id)
        if message_conversation is None or message_conversation.workspace_id != workspace_id:
            raise AppError(422, "Input message must belong to the task workspace")
        if conversation_id is not None and message.conversation_id != conversation_id:
            raise AppError(422, "Input message must belong to the task conversation")


@router.get("", response_model=SuccessResponse[list[TaskListItemRead]])
async def list_tasks(
    workspace_id: int | None = Query(default=None, gt=0),
    task_status: TaskStatus | None = Query(default=None, alias="status"),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    session: AsyncSession = Depends(get_db),
) -> SuccessResponse[list[TaskListItemRead]]:
    statement = select(Task).options(selectinload(Task.assigned_agent))
    if workspace_id is not None:
        statement = statement.where(Task.workspace_id == workspace_id)
    if task_status is not None:
        statement = statement.where(Task.status == task_status)
    tasks = (
        await session.scalars(
            statement.order_by(Task.id.desc()).offset(offset).limit(limit)
        )
    ).all()
    return SuccessResponse(data=[_task_list_item(task) for task in tasks])


@router.post(
    "", response_model=SuccessResponse[TaskRead], status_code=status.HTTP_201_CREATED
)
async def create_task(
    payload: TaskCreate,
    session: AsyncSession = Depends(get_db),
) -> SuccessResponse[TaskRead]:
    await _validate_references(
        session,
        payload.workspace_id,
        payload.conversation_id,
        payload.assigned_agent_id,
        payload.input_message_id,
    )
    task = Task(**payload.model_dump())
    session.add(task)
    await commit_or_conflict(session)
    await session.refresh(task)
    return SuccessResponse(data=task)


@router.get("/{task_id}", response_model=SuccessResponse[TaskDetailRead])
async def get_task(
    task_id: int,
    session: AsyncSession = Depends(get_db),
) -> SuccessResponse[TaskDetailRead]:
    statement = (
        select(Task)
        .where(Task.id == task_id)
        .options(
            selectinload(Task.assigned_agent),
            selectinload(Task.input_message),
            selectinload(Task.steps).selectinload(TaskStep.agent),
            selectinload(Task.model_calls).selectinload(ModelCall.agent),
        )
    )
    task = await session.scalar(statement)
    if task is None:
        raise AppError(404, "Task not found")
    return SuccessResponse(data=_task_detail(task))


@router.post("/{task_id}/run", response_model=SuccessResponse[TaskRead])
async def run_task(
    task_id: int,
    session: AsyncSession = Depends(get_db),
) -> SuccessResponse[TaskRead]:
    """Run one pending task inline.

    Keeping execution behind the orchestrator boundary lets a later Redis
    dispatcher enqueue the same task id without changing task semantics.
    """
    try:
        task = await AgentOrchestrator(session).run_task(task_id)
    except TaskNotFoundError as exc:
        raise AppError(404, str(exc)) from exc
    except TaskNotRunnableError as exc:
        raise AppError(409, str(exc)) from exc
    return SuccessResponse(data=task)


@router.patch("/{task_id}", response_model=SuccessResponse[TaskRead])
async def update_task(
    task_id: int,
    payload: TaskUpdate,
    session: AsyncSession = Depends(get_db),
) -> SuccessResponse[TaskRead]:
    task = await session.get(Task, task_id)
    if task is None:
        raise AppError(404, "Task not found")
    updates = payload.model_dump(exclude_unset=True)
    previous_status = task.status
    await _validate_references(
        session,
        task.workspace_id,
        updates.get("conversation_id", task.conversation_id),
        updates.get("assigned_agent_id", task.assigned_agent_id),
        updates.get("input_message_id", task.input_message_id),
    )
    for field, value in updates.items():
        setattr(task, field, value)
    await commit_or_conflict(session)
    await session.refresh(task)
    if "status" in updates and task.status != previous_status:
        task_data = TaskRead.model_validate(task)
        await websocket_manager.broadcast_to_workspace(
            task.workspace_id,
            create_event("task.status_changed", task_data),
        )
    return SuccessResponse(data=task)
