"""Legacy review rows keep their decisions and default to no reminder delivery."""

import os
import subprocess
import sys
from pathlib import Path


def test_followup_migration_roundtrip(tmp_path: Path) -> None:
    code = """
import asyncio,os
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine,inspect,text
from orbit_api.db import sessionmaker
from orbit_api.models import User,BizCompany,BizJob,BizWorkflowRun
cfg=Config('alembic.ini')
command.upgrade(cfg,'a4c8d0e2f6b9')
async def seed():
    async with sessionmaker()() as db:
        u=User(email='followups@example.com',password_hash='unused',name='Owner',email_verified=True)
        db.add(u);await db.flush()
        c=BizCompany(slug='followups-migration',name='Followups',website='https://example.com',
                     domain='example.com',dns_token='test',created_by=u.id)
        db.add(c);await db.flush()
        j=BizJob(company_id=c.id,title='Role',slug='role')
        db.add(j);await db.flush()
        db.add(BizWorkflowRun(id='run',company_id=c.id,job_id=j.id,request_sha256='a'*64,
            plan_revision=1,start_date='2026-10-30',content={'title':'Checklist'},tasks={}))
        await db.commit();return c.id
cid=asyncio.run(seed())
engine=create_engine(os.environ['ORBIT_DATABASE_URL'].replace('+aiosqlite',''))
with engine.begin() as db:
    db.execute(text('INSERT INTO biz_workflow_reviews '
        '(id,company_id,run_id,step_id,request_sha256,fingerprint,evidence,request_note,response_note,'
        'status,invalidation_reason,created_at) '
        "VALUES ('review',:cid,'run','gate','hash','hash','{}','Existing evidence','Existing decision',"
        "'approved','',CURRENT_TIMESTAMP)"),{'cid':cid})
for _ in range(2):
    command.upgrade(cfg,'head')
    with engine.connect() as db:
        row=db.execute(text('SELECT reminders_enabled,reminder_count,due_date,previous_review_id,handoff_note '
            "FROM biz_workflow_reviews WHERE id='review'")).one()
        assert row==(False,0,None,None,'')
    command.downgrade(cfg,'a4c8d0e2f6b9')
    assert 'due_date' not in {c['name'] for c in inspect(engine).get_columns('biz_workflow_reviews')}
    with engine.connect() as db:
        row=db.execute(text("SELECT status,response_note FROM biz_workflow_reviews WHERE id='review'")).one()
        assert row==('approved','Existing decision')
engine.dispose()
"""
    result = subprocess.run(
        [sys.executable, "-c", code],
        cwd=Path(__file__).resolve().parents[1],
        env={
            **os.environ,
            "ORBIT_ENV": "test",
            "ORBIT_DATABASE_URL": f"sqlite+aiosqlite:///{tmp_path / 'followups.db'}",
        },
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert result.returncode == 0, result.stdout + result.stderr
