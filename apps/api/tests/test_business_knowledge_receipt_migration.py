"""Receipt table upgrade/downgrade preserves publication history and cascades private receipt deletion."""

import os
import subprocess
import sys
from pathlib import Path


def test_receipt_migration_roundtrip(tmp_path: Path) -> None:
    code = """
import asyncio, os
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, text
from orbit_api.db import sessionmaker
from orbit_api.models import User, BizCompany, BizKnowledgeDocument, BizKnowledgePublication
cfg = Config('alembic.ini')
command.upgrade(cfg, 'de82f4b5c930')
async def seed():
    async with sessionmaker()() as db:
        user = User(email='receipt-owner@example.com', password_hash='unused', name='Owner', email_verified=True)
        db.add(user)
        await db.flush()
        company = BizCompany(slug='receipt-migration', name='Receipt Company', website='https://example.com',
                             domain='example.com', dns_token='test', created_by=user.id)
        db.add(company)
        await db.flush()
        content = {'title':'Policy','body':'Keep the complete published text and history during this migration.',
                   'audience':'all_hiring','category':'policy','review_due':''}
        doc = BizKnowledgeDocument(company_id=company.id, created_by=user.id, draft=content, published=content,
                                   revision=2, published_revision=2)
        db.add(doc)
        await db.flush()
        db.add(BizKnowledgePublication(document_id=doc.id, revision=2, content=content, actor_name='Owner'))
        await db.commit()
        return user.id, doc.id
uid, did = asyncio.run(seed())
engine = create_engine(os.environ['ORBIT_DATABASE_URL'].replace('+aiosqlite', ''))
for _ in range(2):
    command.upgrade(cfg, 'head')
    with engine.begin() as db:
        db.execute(text('PRAGMA foreign_keys=ON'))
        assert db.execute(text('SELECT count(*) FROM biz_knowledge_receipts')).scalar() == 0
        db.execute(text('INSERT INTO biz_knowledge_receipts '
            '(document_id,user_id,content_hash,published_revision,acknowledged_at) '
            'VALUES (:did,:uid,:hash,2,CURRENT_TIMESTAMP)'), {'did':did,'uid':uid,'hash':'a'*64})
        assert db.execute(text('SELECT count(*) FROM biz_knowledge_publications')).scalar() == 1
    command.downgrade(cfg, 'de82f4b5c930')
    with engine.connect() as db:
        assert db.execute(text('SELECT count(*) FROM biz_knowledge_publications')).scalar() == 1
        assert db.execute(text('SELECT count(*) FROM biz_knowledge_documents')).scalar() == 1
command.upgrade(cfg, 'head')
with engine.begin() as db:
    db.execute(text('PRAGMA foreign_keys=ON'))
    db.execute(text('INSERT INTO biz_knowledge_receipts '
        '(document_id,user_id,content_hash,published_revision,acknowledged_at) '
        'VALUES (:did,:uid,:hash,2,CURRENT_TIMESTAMP)'), {'did':did,'uid':uid,'hash':'a'*64})
    db.execute(text('DELETE FROM biz_knowledge_documents WHERE id=:did'), {'did':did})
    assert db.execute(text('SELECT count(*) FROM biz_knowledge_receipts')).scalar() == 0
engine.dispose()
"""
    env = {**os.environ, "ORBIT_ENV": "test", "ORBIT_DATABASE_URL": f"sqlite+aiosqlite:///{tmp_path / 'receipts.db'}"}
    result = subprocess.run(
        [sys.executable, "-c", code],
        cwd=Path(__file__).resolve().parents[1],
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert result.returncode == 0, result.stdout + result.stderr
