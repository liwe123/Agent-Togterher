from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, utc_now


class QuotaConfig(Base):
    __tablename__ = "quota_configs"

    id: Mapped[int] = mapped_column(primary_key=True)
    workspace_id: Mapped[int] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), unique=True, index=True
    )
    monthly_budget_usd: Mapped[float] = mapped_column(Float, default=100.0)
    max_monthly_tokens: Mapped[int] = mapped_column(Integer, default=10_000_000)
    max_concurrent_tasks: Mapped[int] = mapped_column(Integer, default=5)
    rate_limit_per_minute: Mapped[int] = mapped_column(Integer, default=60)
    is_hard_limit: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now
    )
