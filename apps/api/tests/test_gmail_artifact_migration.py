"""Moving legacy MIME to binary storage and back preserves exact reviewed bytes and metadata."""
import os
import subprocess
import sys
from pathlib import Path


def test_gmail_artifact_migration_roundtrip(tmp_path: Path) -> None:
    code = """
import base64, json, os
from sqlalchemy import create_engine, inspect, text
from alembic import command
from alembic.config import Config
engine = create_engine(os.environ['ORBIT_DATABASE_URL'].replace('+aiosqlite', ''))
with engine.begin() as db:
    db.execute(text('CREATE TABLE gmail_attempts (id VARCHAR(36) PRIMARY KEY, data JSON NOT NULL)'))
    for i in range(3):
        raw = (b'Exact MIME including binary bytes: \\x00\\xff\\r\\n' * 10000) + str(i).encode()
        data = {'mime': base64.b64encode(raw).decode(), 'subject': f'Application {i}',
                'sha256': 'unchanged-digest', 'deliveries': [{'status':'rejected'}]}
        db.execute(text('INSERT INTO gmail_attempts VALUES (:id,:data)'), {'id':str(i),'data':json.dumps(data)})
cfg = Config('alembic.ini')
command.stamp(cfg, 'da02b4c6e8f0')
for _ in range(2):
    command.upgrade(cfg, 'eb13c5d7f9a1')
    with engine.connect() as db:
        for row in db.execute(text('SELECT id, data, content FROM gmail_attempts '
                                   'JOIN gmail_artifacts ON id=attempt_id')):
            data = json.loads(row.data)
            assert 'mime' not in data
            assert data['subject'] == f'Application {row.id}'
            assert data['deliveries'] == [{'status':'rejected'}]
            assert row.content == (b'Exact MIME including binary bytes: \\x00\\xff\\r\\n' * 10000) + row.id.encode()
    command.downgrade(cfg, 'da02b4c6e8f0')
    assert 'gmail_artifacts' not in inspect(engine).get_table_names()
    with engine.connect() as db:
        for row in db.execute(text('SELECT id, data FROM gmail_attempts')):
            data = json.loads(row.data)
            assert base64.b64decode(data['mime']) == (b'Exact MIME including binary bytes: \\x00\\xff\\r\\n' * 10000) \
                                                   + row.id.encode()
engine.dispose()
"""
    env = {**os.environ, "ORBIT_ENV": "test",
           "ORBIT_DATABASE_URL": f"sqlite+aiosqlite:///{(tmp_path / 'gmail-artifacts.db').as_posix()}"}
    result = subprocess.run([sys.executable, "-c", code], cwd=Path(__file__).resolve().parents[1],
                            env=env, capture_output=True, text=True, timeout=60)
    assert result.returncode == 0, result.stdout + result.stderr
