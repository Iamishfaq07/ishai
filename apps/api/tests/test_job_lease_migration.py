"""Lease columns are additive and preserve legacy job payloads and terminal states."""
import os
import subprocess
import sys
from pathlib import Path


def test_job_lease_migration_roundtrip(tmp_path: Path) -> None:
    code = """
import os
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text
engine = create_engine(os.environ['ORBIT_DATABASE_URL'].replace('+aiosqlite', ''))
with engine.begin() as db:
    db.execute(text('CREATE TABLE jobs (id VARCHAR(36) PRIMARY KEY, payload JSON, status VARCHAR(16))'))
    db.execute(text('INSERT INTO jobs VALUES (:id,:payload,:status)'),
               {'id':'retained-job','payload':'{"session_id":"retained-session"}','status':'failed'})
cfg = Config('alembic.ini')
command.stamp(cfg, 'f2a4b6c8d0e1')
command.upgrade(cfg, 'ec24d6e8f0b2')
with engine.connect() as db:
    row = db.execute(text('SELECT * FROM jobs')).one()
    assert row.lease_token is None and row.lease_until is None and not row.rerun_requested
    assert row.payload == '{"session_id":"retained-session"}' and row.status == 'failed'
command.downgrade(cfg, 'f2a4b6c8d0e1')
assert 'lease_token' not in {c['name'] for c in inspect(engine).get_columns('jobs')}
with engine.connect() as db:
    assert db.execute(text('SELECT status FROM jobs')).scalar() == 'failed'
command.upgrade(cfg, 'ec24d6e8f0b2')
engine.dispose()
"""
    env = {**os.environ, "ORBIT_ENV": "test",
           "ORBIT_DATABASE_URL": f"sqlite+aiosqlite:///{(tmp_path / 'leases.db').as_posix()}"}
    result = subprocess.run([sys.executable, "-c", code], cwd=Path(__file__).resolve().parents[1],
                            env=env, capture_output=True, text=True, timeout=60)
    assert result.returncode == 0, result.stdout + result.stderr
