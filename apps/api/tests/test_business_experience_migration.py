"""Experience migration roundtrips and cascades without altering existing job/application data."""

import os
import subprocess
import sys
from pathlib import Path


def test_experience_migration_roundtrip(tmp_path: Path) -> None:
    code = """
import asyncio, os
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, text, inspect
from orbit_api.db import sessionmaker
from orbit_api.models import User, BizCompany, BizJob, BizApplication
cfg = Config('alembic.ini')
command.upgrade(cfg, 'b8d2f4a6c1e3')
async def seed():
    async with sessionmaker()() as db:
        user = User(email='experience-owner@example.com', password_hash='unused', name='Owner', email_verified=True)
        db.add(user)
        await db.flush()
        company = BizCompany(slug='experience-migration', name='Experience Company', website='https://example.com',
                             domain='example.com', dns_token='test', created_by=user.id)
        db.add(company)
        await db.flush()
        job = BizJob(company_id=company.id, title='Existing job', slug='existing-job')
        db.add(job)
        await db.flush()
        app = BizApplication(company_id=company.id, job_id=job.id, reference='experience01', name='Candidate',
                             email='candidate@example.com', stage_id='interview', status_token_hash='a'*64)
        db.add(app)
        await db.flush()
        await db.commit()
        return company.id, job.id, app.id
cid,jid,aid = asyncio.run(seed())
engine = create_engine(os.environ['ORBIT_DATABASE_URL'].replace('+aiosqlite', ''))
for _ in range(2):
    command.upgrade(cfg, 'head')
    with engine.begin() as db:
        db.execute(text('PRAGMA foreign_keys=ON'))
        assert db.execute(text('SELECT count(*) FROM biz_experience_campaigns')).scalar() == 0
        db.execute(text('INSERT INTO biz_experience_campaigns '
            '(job_id,company_id,revision,enabled,stage_kinds,expiry_days,plan) '
            "VALUES (:jid,:cid,1,0,'[]',14,'{}')"), {'jid':jid,'cid':cid})
        db.execute(text('INSERT INTO biz_experience_invites '
            '(application_id,company_id,job_id,survey_version,expires_at,created_at) '
            "VALUES (:aid,:cid,:jid,'test',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)"), {'aid':aid,'cid':cid,'jid':jid})
        db.execute(text('INSERT INTO biz_experience_responses '
            '(application_id,ratings,improvement,notice_sha256,created_at) '
            "VALUES (:aid,'{}','none',:hash,CURRENT_TIMESTAMP)"), {'aid':aid,'hash':'b'*64})
        assert db.execute(text('SELECT title FROM biz_jobs WHERE id=:jid'), {'jid':jid}).scalar() == 'Existing job'
    command.downgrade(cfg, 'b8d2f4a6c1e3')
    assert 'biz_experience_responses' not in inspect(engine).get_table_names()
    with engine.connect() as db:
        assert db.execute(text('SELECT count(*) FROM biz_applications WHERE id=:aid'), {'aid':aid}).scalar() == 1
command.upgrade(cfg, 'head')
with engine.begin() as db:
    db.execute(text('PRAGMA foreign_keys=ON'))
    db.execute(text('INSERT INTO biz_experience_invites '
        '(application_id,company_id,job_id,survey_version,expires_at,created_at) '
        "VALUES (:aid,:cid,:jid,'test',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)"), {'aid':aid,'cid':cid,'jid':jid})
    db.execute(text('INSERT INTO biz_experience_responses '
        '(application_id,ratings,improvement,notice_sha256,created_at) '
        "VALUES (:aid,'{}','none',:hash,CURRENT_TIMESTAMP)"), {'aid':aid,'hash':'b'*64})
    db.execute(text('DELETE FROM biz_applications WHERE id=:aid'), {'aid':aid})
    assert db.execute(text('SELECT count(*) FROM biz_experience_responses')).scalar() == 0
engine.dispose()
"""
    env = {**os.environ, "ORBIT_ENV": "test", "ORBIT_DATABASE_URL": f"sqlite+aiosqlite:///{tmp_path / 'experience.db'}"}
    result = subprocess.run(
        [sys.executable, "-c", code],
        cwd=Path(__file__).resolve().parents[1],
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert result.returncode == 0, result.stdout + result.stderr
