from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, utc_now
from app.models.enums import TaskStatus, string_enum

if TYPE_CHECKING:
    from app.models.agent import Agent
    from app.models.conversation import Conversation
    from app.models.message import Message
    from app.models.model_call import ModelCall
    from app.models.workspace import Workspace


class Task(Base):
    __tablename__ = "tasks"

    id: Mapped[int] = mapped_column(primary_key=True)
    workspace_id: Mapped[int] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    conversation_id: Mapped[int | None] = mapped_column(
        ForeignKey("conversations.id", ondelete="SET NULL"), nullable=True, index=True
    )
    title: Mapped[str] = mapped_column(String(255))
    description: Mapped[str] = mapped_column(Text, default="")
    assigned_agent_id: Mapped[int | None] = mapped_column(
        ForeignKey("agents.id", ondelete="SET NULL"), nullable=True, index=True
    )
    status: Mapped[TaskStatus] = mapped_column(
        string_enum(TaskStatus, "task_status_enum"),
        default=TaskStatus.PENDING,
        index=True,
    )
    priority: Mapped[str] = mapped_column(String(20), default="normal", index=True)
    input_message_id: Mapped[int | None] = mapped_column(
        ForeignKey("messages.id", ondelete="SET NULL"), nullable=True
    )
    result: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now
    )
    execution_token: Mapped[str | None] = mapped_column(
        String(36), nullable=True, index=True
    )
    execution_token_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )

    workspace: Mapped["Workspace"] = relationship(back_populates="tasks")
    conversation: Mapped["Conversation | None"] = relationship(back_populates="tasks")
    assigned_agent: Mapped["Agent | None"] = relationship(
        back_populates="assigned_tasks", foreign_keys=[assigned_agent_id]
    )
    input_message: Mapped["Message | None"] = relationship(
        back_populates="input_for_tasks", foreign_keys=[input_message_id]
    )
    steps: Mapped[list["TaskStep"]] = relationship(
        back_populates="task", cascade="all, delete-orphan"
    )
    model_calls: Mapped[list["ModelCall"]] = relationship(
        back_populates="task", cascade="all, delete-orphan"
    )


class TaskStep(Base):
    __tablename__ = "task_steps"

    id: Mapped[int] = mapped_column(primary_key=True)
    task_id: Mapped[int] = mapped_column(
        ForeignKey("tasks.id", ondelete="CASCADE"), index=True
    )
    agent_id: Mapped[int | None] = mapped_column(
        ForeignKey("agents.id", ondelete="SET NULL"), nullable=True, index=True
    )
    step_name: Mapped[str] = mapped_column(String(255))
    input: Mapped[str | None] = mapped_column(Text, nullable=True)
    output: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="pending", index=True)
    started_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    finished_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # C-185: DAG 工作流引擎——步骤所属节点 id（nodes_json 内的 node["id"]）
    node_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    # C-185: 前置 node_id 列表的 JSON，记录该步骤节点的 DAG 依赖
    dependencies_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    # C-185: 全局递增执行序号（按层分配，层内按节点顺序）
    order_index: Mapped[int | None] = mapped_column(Integer, nullable=True)

    task: Mapped["Task"] = relationship(back_populates="steps")
    agent: Mapped["Agent | None"] = relationship(back_populates="task_steps")
