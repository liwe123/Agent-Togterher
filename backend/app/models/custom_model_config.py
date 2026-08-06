from __future__ import annotations
from sqlalchemy import DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base, utc_now

class CustomModelConfig(Base):
    __tablename__ = "custom_model_configs"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True, nullable=False, index=True)
    provider: Mapped[str] = mapped_column(String(50), nullable=False)
    model: Mapped[str] = mapped_column(String(255), nullable=False)
    purpose: Mapped[str] = mapped_column(Text, default="", nullable=False)
    fallback_model: Mapped[str | None] = mapped_column(String(100), nullable=True)
    created_at: Mapped[str] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[str] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)
