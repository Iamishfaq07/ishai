"""Destructive migration proof on an explicitly named, empty LOCAL disposable database only.

Run from apps/api: ORBIT_DATABASE_URL=postgresql+asyncpg://.../orbit_unified_migration
uv run python ../../tools/check_candidate_identity_postgres.py
No production credentials, provider calls or owner approval claims.
"""
import asyncio
import json
import os
import uuid

from alembic.config import Config
from sqlalchemy import MetaData, Table, func, select, text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from alembic import command

url = make_url(os.environ["ORBIT_DATABASE_URL"])
if (url.drivername != "postgresql+asyncpg" or url.host not in ("localhost", "127.0.0.1")
        or not (url.database or "").startswith("orbit_unified_")):
    raise SystemExit("Use an empty local orbit_unified_* disposable PostgreSQL database only.")
os.environ["ORBIT_ENV"] = "test"

from orbit_api.models import Resume, User  # noqa: E402

cfg = Config("alembic.ini")
uid, rid, jid = [str(uuid.uuid4()) for _ in range(3)]
prefs = {"titles": ["Fixture developer"], "locations": ["Fixture location"]}
content = {"basics": {"name": "Synthetic migration fixture"}}


async def empty() -> None:
    engine = create_async_engine(url)
    async with engine.connect() as db:
        tables = await db.scalars(text("SELECT tablename FROM pg_tables WHERE schemaname='public'"))
        for table in tables:
            if table == "alembic_version":
                continue
            source = Table(table, MetaData(), schema="public")
            if await db.scalar(select(func.count()).select_from(source)):
                raise RuntimeError("Refusing to reset a database containing fixture or user rows")
    await engine.dispose()


async def seed() -> None:
    engine = create_async_engine(url)
    async with AsyncSession(engine) as db:
        db.add(User(id=uid, email=f"migration-{uid}@example.com", name="Synthetic migration fixture",
                    password_hash=uuid.uuid4().hex))
        await db.flush()
        db.add(Resume(id=rid, user_id=uid, title="Original source", data=content))
        await db.flush()
        # Seed the historical schema explicitly; today's ORM may contain newer additive columns.
        await db.execute(text("INSERT INTO job_applications "
            "(id,user_id,listing_id,source,company,title,location,url,apply_url,status,notes,resume_id,"
            "status_at,updated_at,created_at) VALUES (:jid,:uid,:jid,'manual','Fixture company','Fixture role',"
            "'','','','saved','',:rid,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)"),
            {"jid": jid, "uid": uid, "rid": rid})
        await db.execute(text("INSERT INTO job_search_profiles (user_id,prefs,resume_id,created_at,updated_at) "
                              "VALUES (:uid,CAST(:prefs AS JSON),:rid,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)"),
                         {"uid": uid, "rid": rid, "prefs": json.dumps(prefs)})
        await db.commit()
    await engine.dispose()


async def verify(*, column: bool, write: bool = False) -> None:
    engine = create_async_engine(url)
    async with engine.begin() as db:
        profile = (await db.execute(text("SELECT prefs,resume_id FROM job_search_profiles WHERE user_id=:uid"),
                                    {"uid": uid})).one()
        assert profile.prefs == prefs and profile.resume_id == rid
        resume = (await db.execute(text("SELECT title,data FROM resumes WHERE id=:rid"), {"rid": rid})).one()
        assert resume.title == "Original source" and resume.data == content
        assert await db.scalar(text("SELECT resume_id FROM job_applications WHERE id=:jid"), {"jid": jid}) == rid
        if column:
            assert await db.scalar(text("SELECT career_identity FROM job_search_profiles WHERE user_id=:uid"),
                                   {"uid": uid}) is None  # no inferred legacy approval or restoration
            if write:
                await db.execute(text("UPDATE job_search_profiles SET career_identity=CAST(:proof AS JSON) "
                                      "WHERE user_id=:uid"),
                                 {"uid": uid, "proof": json.dumps({"resume_id": rid, "revision": 0})})
        else:
            assert not await db.scalar(text("SELECT count(*) FROM information_schema.columns "
                "WHERE table_schema='public' AND table_name='job_search_profiles' AND column_name='career_identity'"))
    await engine.dispose()


asyncio.run(empty())
command.upgrade(cfg, "head")
command.downgrade(cfg, "base")
command.upgrade(cfg, "d51e7c9a240b")
asyncio.run(seed())
command.upgrade(cfg, "head")
asyncio.run(verify(column=True, write=True))
command.downgrade(cfg, "d51e7c9a240b")
asyncio.run(verify(column=False))
command.upgrade(cfg, "head")
asyncio.run(verify(column=True))
print("PASS: PostgreSQL full graph round-trip; identity rollback preserves fixture profile, source resume and job.")
