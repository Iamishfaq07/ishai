"""Either previously released migration branch can reach the combined schema."""

import os
import subprocess
import sys
from pathlib import Path

import pytest


@pytest.mark.parametrize("previous", ["eb13c5d7f9a1", "ec24d6e8f0b2", "ef93a6c7d041", "a7c9e1b3d5f2", "c3e5a7b9d1f4"])
def test_combined_upgrade_from_either_branch(tmp_path: Path, previous: str) -> None:
    code = """
import os
from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, inspect, text
cfg = Config('alembic.ini')
heads = ScriptDirectory.from_config(cfg).get_heads()
assert len(heads) == 1
assert 'ad418a8cecb0' in {r.revision for r in ScriptDirectory.from_config(cfg).walk_revisions()}
command.upgrade(cfg, os.environ['TEST_PREVIOUS_REVISION'])
command.upgrade(cfg, 'head')
engine = create_engine(os.environ['ORBIT_DATABASE_URL'].replace('+aiosqlite', ''))
assert 'gmail_artifacts' in inspect(engine).get_table_names()
tables = set(inspect(engine).get_table_names())
assert {'job_hidden', 'biz_knowledge_receipts', 'mentor_shares', 'biz_experience_responses'} <= tables
columns = {c['name'] for c in inspect(engine).get_columns('jobs')}
assert {'lease_token', 'lease_until', 'rerun_requested'} <= columns
with engine.connect() as db:
    assert db.execute(text('SELECT version_num FROM alembic_version')).scalars().all() == heads
engine.dispose()
"""
    env = {
        **os.environ,
        "ORBIT_ENV": "test",
        "TEST_PREVIOUS_REVISION": previous,
        "ORBIT_DATABASE_URL": f"sqlite+aiosqlite:///{tmp_path / 'combined.db'}",
    }
    result = subprocess.run(
        [sys.executable, "-c", code],
        cwd=Path(__file__).resolve().parents[1],
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert result.returncode == 0, result.stdout + result.stderr
