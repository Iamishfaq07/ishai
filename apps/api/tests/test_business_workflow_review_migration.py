"""Approval schema upgrades alongside pre-existing workflow state and cascades its evidence."""

import os
import subprocess
import sys
from pathlib import Path


def test_review_migration_roundtrip(tmp_path: Path) -> None:
    code = """
import asyncio, os
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text
from orbit_api.db import sessionmaker
from orbit_api.models import User, BizCompany, BizJob, BizWorkflowRun
cfg=Config('alembic.ini')
command.upgrade(cfg,'f2b6c8d0e5a7')
async def seed():
    async with sessionmaker()() as db:
        u=User(email='review-owner@example.com',password_hash='unused',name='Owner',email_verified=True)
        db.add(u);await db.flush()
        c=BizCompany(slug='review-migration',name='Reviews',website='https://example.com',
                     domain='example.com',dns_token='test',created_by=u.id)
        db.add(c);await db.flush()
        j=BizJob(company_id=c.id,title='Existing role',slug='existing-role')
        db.add(j);await db.flush()
        r=BizWorkflowRun(id='existing-run',company_id=c.id,job_id=j.id,request_sha256='a'*64,plan_revision=1,
                         start_date='2026-10-30',content={'title':'Existing checklist'},tasks={})
        db.add(r);await db.commit()
        return c.id,j.id,u.id
cid,jid,uid=asyncio.run(seed())
engine=create_engine(os.environ['ORBIT_DATABASE_URL'].replace('+aiosqlite',''))
def insert(db):
    db.execute(text('INSERT INTO biz_workflow_reviews '
        '(id,company_id,run_id,step_id,requester_id,reviewer_id,request_sha256,fingerprint,evidence,'
        'request_note,response_note,status,invalidation_reason,created_at) '
        "VALUES ('review',:cid,'existing-run','gate',:uid,:uid,'hash','hash','{}','Review evidence',"
        "'','pending','',CURRENT_TIMESTAMP)"), {'cid':cid,'uid':uid})
for _ in range(2):
    command.upgrade(cfg,'head')
    with engine.begin() as db:
        db.execute(text('PRAGMA foreign_keys=ON'));insert(db)
        assert db.execute(text('SELECT count(*) FROM biz_workflow_runs')).scalar()==1
    command.downgrade(cfg,'f2b6c8d0e5a7')
    assert 'biz_workflow_reviews' not in inspect(engine).get_table_names()
command.upgrade(cfg,'head')
with engine.begin() as db:
    db.execute(text('PRAGMA foreign_keys=ON'));insert(db)
    db.execute(text("DELETE FROM biz_workflow_runs WHERE id='existing-run'"))
    assert db.execute(text('SELECT count(*) FROM biz_workflow_reviews')).scalar()==0
    assert db.execute(text('SELECT count(*) FROM biz_jobs')).scalar()==1
engine.dispose()
"""
    result = subprocess.run(
        [sys.executable, "-c", code],
        cwd=Path(__file__).resolve().parents[1],
        env={**os.environ, "ORBIT_ENV": "test", "ORBIT_DATABASE_URL": f"sqlite+aiosqlite:///{tmp_path / 'reviews.db'}"},
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert result.returncode == 0, result.stdout + result.stderr
