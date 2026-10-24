"""Upgrade existing candidate rows without opting them into hosted execution; exercise rollback too."""
import os
import subprocess
import sys
from pathlib import Path


def test_hosted_migration_preserves_old_rows_and_defaults(tmp_path: Path) -> None:
    database = tmp_path / "migration.db"
    code = """
import os
from sqlalchemy import create_engine, text, inspect
from alembic import command
from alembic.config import Config
engine = create_engine(os.environ['ORBIT_DATABASE_URL'].replace('+aiosqlite', ''))
with engine.begin() as c:
    c.execute(text('CREATE TABLE auto_apply_setups (user_id VARCHAR(36) PRIMARY KEY, resume_id VARCHAR(36))'))
    c.execute(text('CREATE TABLE job_plan_checks (id VARCHAR(36) PRIMARY KEY)'))
    c.execute(text('CREATE TABLE application_packets '
                   '(id VARCHAR(36) PRIMARY KEY, user_id VARCHAR(36), status VARCHAR(16))'))
    c.execute(text("INSERT INTO auto_apply_setups (user_id) VALUES ('existing-candidate')"))
    c.execute(text("INSERT INTO application_packets (id,user_id,status) "
                   "VALUES ('old-packet','existing-candidate','ready')"))
with engine.begin() as prerequisite:
    prerequisite.execute(text('CREATE TABLE job_search_profiles '
                             '(user_id VARCHAR(36) PRIMARY KEY, resume_id VARCHAR(36))'))
cfg = Config('alembic.ini')
command.stamp(cfg, '36a8f2c9d7e1')
command.upgrade(cfg, 'e62f8d0b351c')
with engine.connect() as c:
    assert tuple(c.execute(text('SELECT execution,stop_when_hired FROM auto_apply_setups')).one()) == ('browser',1)
    assert c.execute(text('SELECT agent_mode FROM auto_apply_setups')).scalar() == 0
    assert c.execute(text('SELECT agent_decisions FROM application_packets')).scalar() is None
    assert c.execute(text('SELECT approval_fingerprint FROM application_packets')).scalar() is None
assert 'apply_worker_heartbeats' in inspect(engine).get_table_names()
command.downgrade(cfg, '36a8f2c9d7e1')
assert 'execution' not in {c['name'] for c in inspect(engine).get_columns('auto_apply_setups')}
command.upgrade(cfg, 'e62f8d0b351c')
with engine.connect() as c:
    assert c.execute(text('SELECT status FROM application_packets')).scalar() == 'ready'
engine.dispose()
"""
    env = {**os.environ, "ORBIT_ENV": "test", "ORBIT_HOSTED_APPLY": "false",
           "ORBIT_DATABASE_URL": f"sqlite+aiosqlite:///{database.as_posix()}"}
    result = subprocess.run([sys.executable, "-c", code], env=env, cwd=Path(__file__).resolve().parents[1],
                            capture_output=True, text=True, timeout=60)
    assert result.returncode == 0, result.stdout + result.stderr
