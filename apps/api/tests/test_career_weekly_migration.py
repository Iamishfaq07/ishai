"""Upgrade/downgrade preserves existing users and gives goal rows a real deletion cascade."""
import os
import subprocess
import sys
from pathlib import Path


def test_weekly_goal_migration_roundtrip(tmp_path: Path) -> None:
    code = """
import os
from sqlalchemy import create_engine, inspect, text
from alembic import command
from alembic.config import Config
engine = create_engine(os.environ['ORBIT_DATABASE_URL'].replace('+aiosqlite', ''))
with engine.begin() as c:
    c.execute(text('PRAGMA foreign_keys=ON'))
    c.execute(text('CREATE TABLE users (id VARCHAR(36) PRIMARY KEY)'))
    c.execute(text("INSERT INTO users (id) VALUES ('existing-user')"))
# These focused fixtures stamp an old revision. Include the pre-existing apply tables too:
# later migrations now alter them while the test still upgrades to the real head.
with engine.begin() as c:
    c.execute(text('CREATE TABLE application_packets (id VARCHAR(36) PRIMARY KEY)'))
    c.execute(text('CREATE TABLE auto_apply_setups (user_id VARCHAR(36) PRIMARY KEY)'))
    c.execute(text('CREATE TABLE job_plan_checks (id VARCHAR(36) PRIMARY KEY)'))
    c.execute(text("INSERT INTO application_packets (id) VALUES ('retained-packet')"))
with engine.begin() as prerequisite:
    prerequisite.execute(text('CREATE TABLE job_search_profiles '
                             '(user_id VARCHAR(36) PRIMARY KEY, resume_id VARCHAR(36))'))
cfg = Config('alembic.ini')
command.stamp(cfg, '58ca94f2d7e3')
command.upgrade(cfg, '69db05a3e8f4')
assert 'career_weekly_goals' in inspect(engine).get_table_names()
with engine.begin() as c:
    c.execute(text("INSERT INTO career_weekly_goals VALUES ('existing-user', 1, 8, 2, 0, '2026-10-20')"))
    assert c.execute(text('SELECT applications FROM career_weekly_goals')).scalar() == 8
    c.execute(text("DELETE FROM users WHERE id='existing-user'"))
    assert c.execute(text('SELECT COUNT(*) FROM career_weekly_goals')).scalar() == 0
    c.execute(text("INSERT INTO users (id) VALUES ('retained-user')"))
command.downgrade(cfg, '58ca94f2d7e3')
assert 'career_weekly_goals' not in inspect(engine).get_table_names()
with engine.connect() as c:
    assert c.execute(text('SELECT id FROM users')).scalar() == 'retained-user'
command.upgrade(cfg, '69db05a3e8f4')
with engine.connect() as c:
    assert c.execute(text('SELECT id FROM application_packets')).scalar() == 'retained-packet'
engine.dispose()
"""
    database = tmp_path / "weekly-migration.db"
    env = {**os.environ, "ORBIT_ENV": "test", "ORBIT_DATABASE_URL": f"sqlite+aiosqlite:///{database.as_posix()}"}
    result = subprocess.run([sys.executable, "-c", code], env=env, cwd=Path(__file__).resolve().parents[1],
        capture_output=True, text=True, timeout=60)
    assert result.returncode == 0, result.stdout + result.stderr
