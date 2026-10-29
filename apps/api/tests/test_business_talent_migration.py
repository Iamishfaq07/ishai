"""Roundtrip the talent migration and exercise its two deletion boundaries."""

import os
import subprocess
import sys
from pathlib import Path


def test_talent_migration_roundtrip_and_cascade(tmp_path: Path) -> None:
    code = """
import asyncio, os
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, text, inspect
from orbit_api.db import sessionmaker
from orbit_api.models import User, BizCompany, BizJob, BizApplication
cfg = Config('alembic.ini')
command.upgrade(cfg, 'c9e3f5a7b2d4')
async def seed():
    async with sessionmaker()() as db:
        u = User(email='talent-owner@example.com', password_hash='unused', name='Owner', email_verified=True)
        db.add(u); await db.flush()
        c = BizCompany(slug='talent-migration', name='Talent', website='https://example.com',
                       domain='example.com', dns_token='test', created_by=u.id)
        db.add(c); await db.flush()
        j = BizJob(company_id=c.id, title='Existing role', slug='existing-role')
        db.add(j); await db.flush()
        a = BizApplication(company_id=c.id, job_id=j.id, reference='talent-test', name='Candidate',
                           email='candidate@example.com', stage_id='applied', status_token_hash='a'*64)
        db.add(a); await db.flush(); await db.commit()
        return c.id, j.id, a.id
cid,jid,aid = asyncio.run(seed())
engine = create_engine(os.environ['ORBIT_DATABASE_URL'].replace('+aiosqlite',''))
def membership(db):
    db.execute(text('INSERT INTO biz_talent_pools '
        '(id,company_id,name,purpose,retention_days,enabled,revision,terms_revision,created_at) '
        "VALUES ('pool',:cid,'Pool','Future opportunities',90,1,1,1,CURRENT_TIMESTAMP)"), {'cid':cid})
    db.execute(text('INSERT INTO biz_talent_members '
        '(id,pool_id,application_id,terms_revision,request_id,notice_sha256,notice_version,skills,interests,'
        'search_text,expires_at,consented_at,created_at) '
        "VALUES ('member','pool',:aid,1,'request','hash','test','[]','engineering','engineering',"
        'CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)'), {'aid':aid})
    db.execute(text('INSERT INTO biz_talent_suggestions (id,member_id,job_id,created_at) '
        "VALUES ('suggestion','member',:jid,CURRENT_TIMESTAMP)"), {'jid':jid})
for _ in range(2):
    command.upgrade(cfg, 'head')
    with engine.begin() as db:
        db.execute(text('PRAGMA foreign_keys=ON'))
        membership(db)
        db.execute(text("DELETE FROM biz_talent_pools WHERE id='pool'"))
        assert db.execute(text('SELECT count(*) FROM biz_talent_members')).scalar() == 0
        assert db.execute(text('SELECT count(*) FROM biz_talent_suggestions')).scalar() == 0
        assert db.execute(text('SELECT title FROM biz_jobs WHERE id=:jid'), {'jid':jid}).scalar() == 'Existing role'
    command.downgrade(cfg, 'c9e3f5a7b2d4')
    assert 'biz_talent_pools' not in inspect(engine).get_table_names()
command.upgrade(cfg, 'head')
with engine.begin() as db:
    db.execute(text('PRAGMA foreign_keys=ON'))
    membership(db)
    db.execute(text('DELETE FROM biz_applications WHERE id=:aid'), {'aid':aid})
    assert db.execute(text('SELECT count(*) FROM biz_talent_members')).scalar() == 0
    assert db.execute(text('SELECT count(*) FROM biz_talent_suggestions')).scalar() == 0
engine.dispose()
"""
    env = {**os.environ, "ORBIT_ENV": "test", "ORBIT_DATABASE_URL": f"sqlite+aiosqlite:///{tmp_path / 'talent.db'}"}
    result = subprocess.run(
        [sys.executable, "-c", code],
        cwd=Path(__file__).resolve().parents[1],
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert result.returncode == 0, result.stdout + result.stderr
