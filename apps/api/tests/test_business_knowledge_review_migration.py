"""Adding review ownership preserves live publications/history and leaves reminders disabled."""

import os
import subprocess
import sys
from pathlib import Path


def test_knowledge_review_migration_preserves_history(tmp_path: Path) -> None:
    code = """
import asyncio, json, os
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, text
from orbit_api.db import sessionmaker
from orbit_api.models import User, BizCompany, BizMember
cfg = Config('alembic.ini')
command.upgrade(cfg, 'cd71e3a4b820')
engine = create_engine(os.environ['ORBIT_DATABASE_URL'].replace('+aiosqlite', ''))
# Seed using SQL at the historical schema; ORM's current knowledge model already includes the new fields.
async def seed():
    async with sessionmaker()() as db:
        user = User(email='review-owner@example.com', password_hash='unused', name='Owner', email_verified=True)
        db.add(user)
        await db.flush()
        company = BizCompany(slug='migration-company', name='Migration Company', website='https://example.com',
                             domain='example.com', dns_token='test', created_by=user.id)
        db.add(company)
        await db.flush()
        db.add(BizMember(company_id=company.id, user_id=user.id, role='owner'))
        await db.commit()
        return user.id, company.id
uid, cid = asyncio.run(seed())
content = json.dumps({'title':'Policy','body':'Keep the original published guidance and note.',
                      'audience':'all_hiring','category':'policy','review_due':'2020-01-01'})
with engine.begin() as db:
    db.execute(text('PRAGMA foreign_keys=ON'))
    db.execute(text('INSERT INTO biz_knowledge_documents '
        '(id,company_id,created_by,revision,draft,published,published_revision,archived,created_at,updated_at) '
        "VALUES ('doc',:cid,:uid,2,:body,:body,2,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)"),
        {'cid':cid,'uid':uid,'body':content})
    db.execute(text('INSERT INTO biz_knowledge_publications (id,document_id,revision,content,actor_name,created_at) '
        "VALUES ('publication','doc',2,:body,'Owner',CURRENT_TIMESTAMP)"), {'body':content})
    db.execute(text('INSERT INTO biz_knowledge_events (id,document_id,revision,actor_name,action,note,created_at) '
        "VALUES ('event','doc',2,'Owner','publish','Retain this historical review note',CURRENT_TIMESTAMP)"))
for _ in range(2):
    command.upgrade(cfg, 'de82f4b5c930')
    with engine.connect() as db:
        sql = "SELECT review_owner_id,review_reminders,review_needs_update FROM biz_knowledge_documents WHERE id='doc'"
        row = db.execute(text(sql)).one()
        assert row[0] == uid and not row[1] and not row[2]
        assert db.execute(text('SELECT count(*) FROM biz_knowledge_publications')).scalar() == 1
        note = db.execute(text('SELECT note FROM biz_knowledge_events')).scalar()
        assert note == 'Retain this historical review note'
    command.downgrade(cfg, 'cd71e3a4b820')
    with engine.connect() as db:
        assert db.execute(text('SELECT count(*) FROM biz_knowledge_publications')).scalar() == 1
        published = db.execute(text('SELECT published FROM biz_knowledge_documents')).scalar()
        assert json.loads(published)['title'] == 'Policy'
engine.dispose()
"""
    env = {**os.environ, "ORBIT_ENV": "test", "ORBIT_DATABASE_URL": f"sqlite+aiosqlite:///{tmp_path / 'reviews.db'}"}
    result = subprocess.run(
        [sys.executable, "-c", code],
        cwd=Path(__file__).resolve().parents[1],
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert result.returncode == 0, result.stdout + result.stderr
