from datetime import datetime
from typing import TYPE_CHECKING
from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, utc_now

if TYPE_CHECKING:
    from app.models.user import User
    from app.models.workspace import Workspace


class Plugin(Base):
    __tablename__ = "plugins"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True, index=True, nullable=False)
    display_name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    version: Mapped[str] = mapped_column(String(32), default="1.0.0", nullable=False)
    icon: Mapped[str | None] = mapped_column(String(255), nullable=True)
    author: Mapped[str | None] = mapped_column(String(100), nullable=True)
    manifest_json: Mapped[str] = mapped_column(Text, nullable=False)
    is_public: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_by_user_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now
    )

    created_by: Mapped["User | None"] = relationship("User", foreign_keys=[created_by_user_id])
    workspace_associations: Mapped[list["WorkspacePlugin"]] = relationship(
        "WorkspacePlugin", back_populates="plugin", cascade="all, delete-orphan"
    )


class WorkspacePlugin(Base):
    __tablename__ = "workspace_plugins"
    __table_args__ = (
        UniqueConstraint("workspace_id", "plugin_id", name="uq_workspace_plugin"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    workspace_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("workspaces.id", ondelete="CASCADE"), index=True, nullable=False
    )
    plugin_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("plugins.id", ondelete="CASCADE"), index=True, nullable=False
    )
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    config_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now
    )

    workspace: Mapped["Workspace"] = relationship("Workspace")
    plugin: Mapped["Plugin"] = relationship("Plugin", back_populates="workspace_associations")
