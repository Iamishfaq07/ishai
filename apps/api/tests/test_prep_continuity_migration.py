"""Additive completion metadata retains legacy checkmarks through upgrade, rollback and re-upgrade."""
import os
import subprocess
import sys
from pathlib import Path


def test_prep_snapshot_migration_preserves_legacy_rows(tmp_path: Path) -> None:
    code = """
import os
from sqlalchemy import create_engine, inspect, text
from alembic import command
from alembic.config import Config
engine = create_engine(os.environ['ORBIT_DATABASE_URL'].replace('+aiosqlite', ''))
with engine.begin() as db:
    db.execute(text('CREATE TABLE job_plan_checks (id VARCHAR(36) PRIMARY KEY, item_key VARCHAR(64))'))
    db.execute(text("INSERT INTO job_plan_checks (id,item_key) VALUES ('legacy','2026-10-20:gap:0')"))
cfg = Config('alembic.ini')
command.stamp(cfg, 'c407e21a6d93')
command.upgrade(cfg, 'head')
with engine.begin() as db:
    assert tuple(db.execute(text('SELECT id,item_key,task_data FROM job_plan_checks')).one()) == (
        'legacy','2026-10-20:gap:0',None)
    db.execute(text('UPDATE job_plan_checks SET task_data=:data'), {'data':'{"title":"Retained task"}'})
command.downgrade(cfg, 'c407e21a6d93')
assert 'task_data' not in {c['name'] for c in inspect(engine).get_columns('job_plan_checks')}
with engine.connect() as db:
    assert tuple(db.execute(text('SELECT id,item_key FROM job_plan_checks')).one()) == ('legacy','2026-10-20:gap:0')
command.upgrade(cfg, 'head')
with engine.connect() as db:
    assert db.execute(text('SELECT task_data FROM job_plan_checks')).scalar() is None
engine.dispose()
"""
    env = {**os.environ, "ORBIT_ENV": "test",
           "ORBIT_DATABASE_URL": f"sqlite+aiosqlite:///{(tmp_path / 'prep.db').as_posix()}"}
    result = subprocess.run([sys.executable, "-c", code], env=env, cwd=Path(__file__).resolve().parents[1],
                            capture_output=True, text=True, timeout=60)
    assert result.returncode == 0, result.stdout + result.stderr
