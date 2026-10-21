"""Additive metadata migration preserves source rows and does not approve legacy profiles."""
import os
import subprocess
import sys
from pathlib import Path


def test_identity_upgrade_downgrade_upgrade_preserves_existing_profile(tmp_path: Path) -> None:
    script = """
import json, os
from sqlalchemy import create_engine, text
from alembic import command
from alembic.config import Config
cfg = Config('alembic.ini')
command.upgrade(cfg, 'd51e7c9a240b')
engine = create_engine(os.environ['ORBIT_DATABASE_URL'].replace('+aiosqlite', ''))
with engine.begin() as db:
    db.execute(text("INSERT INTO job_search_profiles (user_id,prefs,updated_at,created_at) "
                    "VALUES ('legacy','{}',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)"))
command.upgrade(cfg, 'head')
with engine.begin() as db:
    assert db.execute(text("SELECT career_identity FROM job_search_profiles")).scalar() is None
    db.execute(text("UPDATE job_search_profiles SET career_identity=:metadata"),
               {'metadata': json.dumps({'resume_id':'explicit-master','revision':7})})
command.downgrade(cfg, 'd51e7c9a240b')
with engine.connect() as db:
    assert db.execute(text("SELECT user_id FROM job_search_profiles")).scalar() == 'legacy'
command.upgrade(cfg, 'head')
with engine.connect() as db:
    assert db.execute(text("SELECT career_identity FROM job_search_profiles")).scalar() is None
engine.dispose()
"""
    env = {**os.environ, "ORBIT_ENV": "test",
           "ORBIT_DATABASE_URL": f"sqlite+aiosqlite:///{(tmp_path / 'identity.db').as_posix()}"}
    result = subprocess.run([sys.executable, "-c", script], cwd=Path(__file__).resolve().parents[1],
                            env=env, capture_output=True, text=True, timeout=90)
    assert result.returncode == 0, result.stdout + result.stderr
