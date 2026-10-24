"""Databases already on either independently shipped personal automation revision converge to one head."""
import os
import subprocess
import sys
from pathlib import Path

import pytest


@pytest.mark.parametrize("first", ["82ac6d705f91", "91bd47e8c2a0"])
def test_personal_migrations_converge_from_either_parent(tmp_path: Path, first: str) -> None:
    script = """
import os
from sqlalchemy import create_engine, inspect, text
from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
cfg = Config('alembic.ini')
command.upgrade(cfg, os.environ['ORBIT_MERGE_FIRST'])
engine = create_engine(os.environ['ORBIT_DATABASE_URL'].replace('+aiosqlite', ''))
with engine.connect() as db:
    assert db.execute(text('SELECT version_num FROM alembic_version')).scalar() == os.environ['ORBIT_MERGE_FIRST']
command.upgrade(cfg, 'e62f8d0b351c')
def check():
    assert 'career_playbooks' in inspect(engine).get_table_names()
    assert 'agent_mode' in {c['name'] for c in inspect(engine).get_columns('auto_apply_setups')}
    assert 'agent_decisions' in {c['name'] for c in inspect(engine).get_columns('application_packets')}
    with engine.connect() as db:
        assert db.execute(text('SELECT version_num FROM alembic_version')).scalars().all() == ['e62f8d0b351c']
check()
command.downgrade(cfg, '7fc84a231d90')
assert 'career_playbooks' not in inspect(engine).get_table_names()
assert 'agent_mode' not in {c['name'] for c in inspect(engine).get_columns('auto_apply_setups')}
command.upgrade(cfg, 'e62f8d0b351c')
check()
engine.dispose()
"""
    env = {**os.environ, "ORBIT_ENV": "test", "ORBIT_MERGE_FIRST": first,
        "ORBIT_DATABASE_URL": f"sqlite+aiosqlite:///{(tmp_path / 'merge.db').as_posix()}"}
    result = subprocess.run([sys.executable, "-c", script], env=env, cwd=Path(__file__).resolve().parents[1],
        capture_output=True, text=True, timeout=60)
    assert result.returncode == 0, result.stdout + result.stderr
