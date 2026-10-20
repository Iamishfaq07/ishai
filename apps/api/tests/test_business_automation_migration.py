"""Upgrade and rollback keep pre-existing enterprise data without enabling new recipes."""
import os
import subprocess
import sys
from pathlib import Path


def test_business_automation_migration(tmp_path: Path) -> None:
    code = """
import os
from sqlalchemy import create_engine, inspect, text
from alembic import command
from alembic.config import Config
engine = create_engine(os.environ['ORBIT_DATABASE_URL'].replace('+aiosqlite', ''))
with engine.begin() as c:
    for name in ('users', 'biz_companies', 'biz_jobs', 'biz_applications'):
        c.execute(text('CREATE TABLE ' + name + ' (id VARCHAR(36) PRIMARY KEY)'))
        c.execute(text('INSERT INTO ' + name + " (id) VALUES ('existing-row')"))
# These focused fixtures stamp an old revision. Include the pre-existing apply tables too:
# later migrations now alter them while the test still upgrades to the real head.
with engine.begin() as c:
    c.execute(text('CREATE TABLE application_packets (id VARCHAR(36) PRIMARY KEY)'))
    c.execute(text('CREATE TABLE auto_apply_setups (user_id VARCHAR(36) PRIMARY KEY)'))
    c.execute(text('CREATE TABLE job_plan_checks (id VARCHAR(36) PRIMARY KEY)'))
    c.execute(text("INSERT INTO application_packets (id) VALUES ('retained-packet')"))
cfg = Config('alembic.ini')
command.stamp(cfg, '47b9e3d0a6f2')
command.upgrade(cfg, 'head')
with engine.connect() as c:
    assert c.execute(text('SELECT COUNT(*) FROM biz_automations')).scalar() == 0
    assert c.execute(text('SELECT COUNT(*) FROM biz_hiring_tasks')).scalar() == 0
assert any(i['name'] == 'uq_biz_task_source' for i in inspect(engine).get_unique_constraints('biz_hiring_tasks'))
command.downgrade(cfg, '47b9e3d0a6f2')
assert 'biz_hiring_tasks' not in inspect(engine).get_table_names()
command.upgrade(cfg, 'head')
with engine.connect() as c:
    assert c.execute(text('SELECT id FROM biz_applications')).scalar() == 'existing-row'
    assert c.execute(text('SELECT id FROM application_packets')).scalar() == 'retained-packet'
engine.dispose()
"""
    database = tmp_path / "automation-migration.db"
    env = {**os.environ, "ORBIT_ENV": "test", "ORBIT_DATABASE_URL": f"sqlite+aiosqlite:///{database.as_posix()}"}
    result = subprocess.run([sys.executable, "-c", code], env=env, cwd=Path(__file__).resolve().parents[1],
        capture_output=True, text=True, timeout=60)
    assert result.returncode == 0, result.stdout + result.stderr
