"""Roundtrip saved-search metadata without changing the preexisting community."""

import os
import subprocess
import sys
from pathlib import Path


def test_talent_search_migration_roundtrip_and_deletion_boundaries(tmp_path: Path) -> None:
    code = """
import asyncio, os
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text
from orbit_api.db import sessionmaker
from orbit_api.models import User, BizCompany, BizTalentPool
cfg = Config('alembic.ini')
command.upgrade(cfg, 'b5d9e1f3a7c0')
async def seed():
    async with sessionmaker()() as db:
        owner = User(email='saved-owner@example.com', password_hash='unused', name='Owner', email_verified=True)
        author = User(email='saved-author@example.com', password_hash='unused', name='Recruiter', email_verified=True)
        db.add_all([owner, author]); await db.flush()
        company = BizCompany(slug='saved-search-migration', name='Existing company', website='https://example.com',
                             domain='example.com', dns_token='test', created_by=owner.id)
        db.add(company); await db.flush()
        pool = BizTalentPool(company_id=company.id, name='Existing community', purpose='Future engineering roles',
                             retention_days=90, enabled=True, revision=3, terms_revision=2)
        db.add(pool); await db.flush(); await db.commit()
        return company.id, pool.id, author.id
cid,pid,author = asyncio.run(seed())
engine = create_engine(os.environ['ORBIT_DATABASE_URL'].replace('+aiosqlite', ''))
for _ in range(2):
    command.upgrade(cfg, 'head')
    assert 'biz_talent_searches' in inspect(engine).get_table_names()
    with engine.begin() as db:
        db.execute(text('INSERT INTO biz_talent_searches '
            '(id,company_id,pool_id,created_by,name,query,terms_revision,revision,request_sha256,created_at) '
            "VALUES ('saved',:cid,:pid,:author,'Backend talent','Python',2,1,'hash',CURRENT_TIMESTAMP)"),
            {'cid':cid, 'pid':pid, 'author':author})
    command.downgrade(cfg, 'b5d9e1f3a7c0')
    assert 'biz_talent_searches' not in inspect(engine).get_table_names()
    with engine.connect() as db:
        name = db.execute(text('SELECT name FROM biz_talent_pools WHERE id=:pid'), {'pid':pid}).scalar()
        assert name == 'Existing community'
        assert db.execute(text('SELECT terms_revision FROM biz_talent_pools WHERE id=:pid'), {'pid':pid}).scalar() == 2
command.upgrade(cfg, 'head')
with engine.begin() as db:
    db.execute(text('PRAGMA foreign_keys=ON'))
    db.execute(text('INSERT INTO biz_talent_searches '
        '(id,company_id,pool_id,created_by,name,query,terms_revision,revision,request_sha256,created_at) '
        "VALUES ('saved',:cid,:pid,:author,'Backend talent','Python',2,1,'hash',CURRENT_TIMESTAMP)"),
        {'cid':cid, 'pid':pid, 'author':author})
    db.execute(text('DELETE FROM users WHERE id=:id'), {'id':author})
    assert db.execute(text("SELECT created_by FROM biz_talent_searches WHERE id='saved'")).scalar() is None
    assert db.execute(text('SELECT count(*) FROM biz_talent_searches')).scalar() == 1
    db.execute(text('DELETE FROM biz_talent_pools WHERE id=:id'), {'id':pid})
    assert db.execute(text('SELECT count(*) FROM biz_talent_searches')).scalar() == 0
    assert db.execute(text('SELECT name FROM biz_companies WHERE id=:cid'), {'cid':cid}).scalar() == 'Existing company'
engine.dispose()
"""
    result = subprocess.run(
        [sys.executable, "-c", code], cwd=Path(__file__).resolve().parents[1],
        env={**os.environ, "ORBIT_ENV": "test",
             "ORBIT_DATABASE_URL": f"sqlite+aiosqlite:///{tmp_path / 'searches.db'}"},
        capture_output=True, text=True, timeout=60,
    )
    assert result.returncode == 0, result.stdout + result.stderr
