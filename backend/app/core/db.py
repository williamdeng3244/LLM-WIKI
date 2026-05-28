"""Async SQLAlchemy engine and session factory."""
from typing import AsyncIterator
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase
from app.core.config import settings


class Base(DeclarativeBase):
    pass


engine = create_async_engine(
    settings.database_url,
    echo=False,
    future=True,
    pool_pre_ping=True,
    # Raised from SQLAlchemy defaults (5 + 10) so a single misbehaving
    # endpoint can't saturate the pool while the frontend retries.
    # Tunable via DB_POOL_SIZE / DB_MAX_OVERFLOW / DB_POOL_RECYCLE
    # env vars. See issue #10.
    pool_size=settings.db_pool_size,
    max_overflow=settings.db_max_overflow,
    pool_recycle=settings.db_pool_recycle,
)
SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def get_session() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        yield session
