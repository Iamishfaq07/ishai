"""Runbook schema upgrades from the released merge point and cascades job deletion."""

import os
import subprocess
import sys
from pathlib import Path


def test_workflow_migration_roundtrip(tmp_path: Path) -> None:
    code = """
import asyncio, os
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text
from orbit_api.db import sessionmaker
from orbit_api.models import User, BizCompany, BizJob
cfg = Config('alembic.ini')
command.upgrade(cfg, 'e1a5b7c9d4f6')
async def seed():
    async with sessionmaker()() as db:
        u=User(email='workflow-owner@example.com',password_hash='unused',name='Owner',email_verified=True)
        db.add(u); await db.flush()
        c=BizCompany(slug='workflow-migration',name='Workflow',website='https://example.com',
                     domain='example.com',dns_token='test',created_by=u.id)
        db.add(c); await db.flush()
        j=BizJob(company_id=c.id,title='Existing job',slug='existing-job')
        db.add(j); await db.flush(); await db.commit()
        return c.id,j.id
cid,jid=asyncio.run(seed())
engine=create_engine(os.environ['ORBIT_DATABASE_URL'].replace('+aiosqlite',''))
for _ in range(2):
    command.upgrade(cfg, 'head')
    with engine.begin() as db:
        db.execute(text('PRAGMA foreign_keys=ON'))
        db.execute(text("INSERT INTO biz_workflow_plans (job_id,revision,content) VALUES (:jid,1,'{}')"), {'jid':jid})
        db.execute(text('INSERT INTO biz_workflow_runs '
            '(id,company_id,job_id,request_sha256,plan_revision,revision,status,start_date,content,tasks,created_at) '
            "VALUES ('run',:cid,:jid,'hash',1,1,'active','2026-10-30','{}','{}',CURRENT_TIMESTAMP)"),
            {'cid':cid,'jid':jid})
    command.downgrade(cfg, 'e1a5b7c9d4f6')
    assert 'biz_workflow_runs' not in inspect(engine).get_table_names()
    with engine.connect() as db:
        assert db.execute(text('SELECT title FROM biz_jobs WHERE id=:jid'), {'jid':jid}).scalar()=='Existing job'
command.upgrade(cfg,'head')
with engine.begin() as db:
    db.execute(text('PRAGMA foreign_keys=ON'))
    db.execute(text("INSERT INTO biz_workflow_plans (job_id,revision,content) VALUES (:jid,1,'{}')"), {'jid':jid})
    db.execute(text('INSERT INTO biz_workflow_runs '
        '(id,company_id,job_id,request_sha256,plan_revision,revision,status,start_date,content,tasks,created_at) '
        "VALUES ('run',:cid,:jid,'hash',1,1,'active','2026-10-30','{}','{}',CURRENT_TIMESTAMP)"), {'cid':cid,'jid':jid})
    db.execute(text('DELETE FROM biz_jobs WHERE id=:jid'), {'jid':jid})
    assert db.execute(text('SELECT count(*) FROM biz_workflow_runs')).scalar()==0
    assert db.execute(text('SELECT count(*) FROM biz_workflow_plans')).scalar()==0
engine.dispose()
"""
    result = subprocess.run(
        [sys.executable, "-c", code],
        cwd=Path(__file__).resolve().parents[1],
        env={
            **os.environ,
            "ORBIT_ENV": "test",
            "ORBIT_DATABASE_URL": f"sqlite+aiosqlite:///{tmp_path / 'workflow.db'}",
        },
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert result.returncode == 0, result.stdout + result.stderr
