from __future__ import annotations
from sqlalchemy import DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base, utc_now

class ProviderCredential(Base):
    __tablename__ = "provider_credentials"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    provider: Mapped[str] = mapped_column(String(50), unique=True, nullable=False, index=True)
    api_key: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[str] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[str] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)
