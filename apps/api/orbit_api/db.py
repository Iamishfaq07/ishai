from collections.abc import AsyncIterator
from typing import Any

from sqlalchemy import JSON, event
from sqlalchemy.engine import Dialect
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.types import TypeDecorator, TypeEngine

from orbit_api.config import get_settings

EMBEDDING_DIM = 384


class Base(DeclarativeBase):
    pass


class EmbeddingType(TypeDecorator[list[float]]):
    """pgvector `vector(N)` on Postgres, JSON list elsewhere (SQLite dev/test)."""

    impl = JSON
    cache_ok = True

    def load_dialect_impl(self, dialect: Dialect) -> TypeEngine[Any]:
        if dialect.name == "postgresql":
            from pgvector.sqlalchemy import Vector

            return dialect.type_descriptor(Vector(EMBEDDING_DIM))
        return dialect.type_descriptor(JSON())

    def process_result_value(self, value: Any, dialect: Dialect) -> list[float] | None:
        if value is None:
            return None
        return [float(x) for x in value]


_engine: AsyncEngine | None = None
_sessionmaker: async_sessionmaker[AsyncSession] | None = None


def get_engine() -> AsyncEngine:
    global _engine, _sessionmaker
    if _engine is None:
        settings = get_settings()
        _engine = create_async_engine(settings.database_url, pool_pre_ping=not settings.is_sqlite)
        if settings.is_sqlite:

            @event.listens_for(_engine.sync_engine, "connect")
            def _fk_on(dbapi_conn: Any, _: Any) -> None:
                dbapi_conn.execute("PRAGMA foreign_keys=ON")

        _sessionmaker = async_sessionmaker(_engine, expire_on_commit=False)
    return _engine


def sessionmaker() -> async_sessionmaker[AsyncSession]:
    get_engine()
    assert _sessionmaker is not None
    return _sessionmaker


async def get_db() -> AsyncIterator[AsyncSession]:
    async with sessionmaker()() as db:
        yield db


async def create_all() -> None:
    """Dev/test convenience. Production schema is managed by Alembic."""
    from orbit_api import models  # noqa: F401  (register tables)

    engine = get_engine()
    async with engine.begin() as conn:
        if engine.dialect.name == "postgresql":
            await conn.exec_driver_sql("CREATE EXTENSION IF NOT EXISTS vector")
        await conn.run_sync(Base.metadata.create_all)


async def dispose() -> None:
    global _engine, _sessionmaker
    if _engine is not None:
        await _engine.dispose()
    _engine = None
    _sessionmaker = None
