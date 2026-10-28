"""Additive Business requisition migration leaves existing company records intact."""
import os
import subprocess
import sys
from pathlib import Path


def test_requisition_migration_roundtrip(tmp_path: Path) -> None:
    code = """
import os
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text
cfg = Config('alembic.ini')
command.upgrade(cfg, 'ad418a8cecb0')
engine = create_engine(os.environ['ORBIT_DATABASE_URL'].replace('+aiosqlite', ''))
with engine.connect() as db:
    tables_before = set(inspect(engine).get_table_names())
for _ in range(2):
    command.upgrade(cfg, 'be39d8a2f710')
    assert {'biz_requisitions', 'biz_requisition_events'} <= set(inspect(engine).get_table_names())
    with engine.connect() as db:
        assert db.execute(text('SELECT count(*) FROM biz_requisitions')).scalar() == 0
    command.downgrade(cfg, 'ad418a8cecb0')
    assert set(inspect(engine).get_table_names()) == tables_before
command.upgrade(cfg, 'head')
assert 'biz_requisitions' in inspect(engine).get_table_names()
engine.dispose()
"""
    env = {**os.environ, "ORBIT_ENV": "test",
           "ORBIT_DATABASE_URL": f"sqlite+aiosqlite:///{tmp_path / 'requisitions.db'}"}
    result = subprocess.run([sys.executable, "-c", code], cwd=Path(__file__).resolve().parents[1],
                            env=env, capture_output=True, text=True, timeout=60)
    assert result.returncode == 0, result.stdout + result.stderr
