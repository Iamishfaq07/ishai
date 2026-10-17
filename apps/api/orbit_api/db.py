import ssl
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


def connect_args(settings: Any) -> dict[str, Any]:
    """TLS for Postgres (see Settings.database_ssl): in production the server's certificate is checked."""
    url = settings.database_url
    if settings.is_sqlite or "ssl=" in url or "sslmode=" in url:
        return {}  # SQLite, or the URL already says how
    mode = settings.database_ssl or ("verify" if settings.env == "production" else "off")
    if mode == "off":
        return {}
    ctx = ssl.create_default_context()
    if mode == "require":
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
    return {"ssl": ctx}


def get_engine() -> AsyncEngine:
    global _engine, _sessionmaker
    if _engine is None:
        settings = get_settings()
        _engine = create_async_engine(settings.database_url, pool_pre_ping=not settings.is_sqlite,
                                      connect_args=connect_args(settings))
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


async def refuses_writes(session: AsyncSession) -> bool:
    """The database answers reads but refuses every write: a Postgres with `default_transaction_read_only = on`, or
    a standby (in recovery). `SELECT 1` passes on both, so a readiness check that only reads says "ok" while every
    sign-in, payment and session write fails (docs/DECISIONS.md D56). Always False on SQLite (dev and tests)."""
    if session.get_bind().dialect.name != "postgresql":
        return False
    from sqlalchemy import text

    return bool((await session.execute(text(
        "SELECT current_setting('transaction_read_only') = 'on' OR pg_is_in_recovery()"))).scalar())


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
