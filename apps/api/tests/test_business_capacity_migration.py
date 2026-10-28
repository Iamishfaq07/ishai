"""Capacity watch schema roundtrips without altering approved requisitions or publication history."""

import os
import subprocess
import sys
from pathlib import Path


def test_capacity_watch_migration_roundtrip(tmp_path: Path) -> None:
    code = """
import asyncio, os
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text
from orbit_api.db import sessionmaker
from orbit_api.models import User, BizCompany, BizRequisition
cfg = Config('alembic.ini')
command.upgrade(cfg, 'f0a4b8d2e615')
async def seed():
    async with sessionmaker()() as db:
        user = User(email='capacity-owner@example.com', password_hash='unused', name='Owner', email_verified=True)
        db.add(user)
        await db.flush()
        company = BizCompany(slug='capacity-migration', name='Capacity Company', website='https://example.com',
                             domain='example.com', dns_token='test', created_by=user.id)
        db.add(company)
        await db.flush()
        req = BizRequisition(company_id=company.id, requester_id=user.id, state='approved',
                             content={'title':'Approved role','positions':2})
        db.add(req)
        await db.flush()
        await db.commit()
        return company.id, req.id
cid, rid = asyncio.run(seed())
engine = create_engine(os.environ['ORBIT_DATABASE_URL'].replace('+aiosqlite', ''))
for _ in range(2):
    command.upgrade(cfg, 'head')
    with engine.begin() as db:
        db.execute(text('PRAGMA foreign_keys=ON'))
        assert db.execute(text('SELECT count(*) FROM biz_capacity_watches')).scalar() == 0
        db.execute(text('INSERT INTO biz_capacity_watches (requisition_id,company_id,revision,enabled) '
                        'VALUES (:rid,:cid,1,0)'), {'rid':rid,'cid':cid})
        assert db.execute(text('SELECT state FROM biz_requisitions WHERE id=:rid'), {'rid':rid}).scalar() == 'approved'
    command.downgrade(cfg, 'f0a4b8d2e615')
    assert 'biz_capacity_watches' not in inspect(engine).get_table_names()
    assert {'job_hidden','biz_knowledge_receipts'} <= set(inspect(engine).get_table_names())
command.upgrade(cfg, 'head')
with engine.begin() as db:
    db.execute(text('PRAGMA foreign_keys=ON'))
    db.execute(text('INSERT INTO biz_capacity_watches (requisition_id,company_id,revision,enabled) '
                    'VALUES (:rid,:cid,1,0)'), {'rid':rid,'cid':cid})
    db.execute(text('DELETE FROM biz_requisitions WHERE id=:rid'), {'rid':rid})
    assert db.execute(text('SELECT count(*) FROM biz_capacity_watches')).scalar() == 0
engine.dispose()
"""
    env = {**os.environ, "ORBIT_ENV": "test", "ORBIT_DATABASE_URL": f"sqlite+aiosqlite:///{tmp_path / 'capacity.db'}"}
    result = subprocess.run(
        [sys.executable, "-c", code],
        cwd=Path(__file__).resolve().parents[1],
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert result.returncode == 0, result.stdout + result.stderr
