"""Business knowledge migration upgrades and rolls back without touching existing Business tables."""

import os
import subprocess
import sys
from pathlib import Path


def test_business_knowledge_migration(tmp_path: Path) -> None:
    code = """
import os
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text
cfg = Config('alembic.ini')
command.upgrade(cfg, 'be39d8a2f710')
engine = create_engine(os.environ['ORBIT_DATABASE_URL'].replace('+aiosqlite', ''))
original = set(inspect(engine).get_table_names())
for _ in range(2):
    command.upgrade(cfg, 'cd71e3a4b820')
    added = {'biz_knowledge_documents', 'biz_knowledge_publications', 'biz_knowledge_events'}
    assert added <= set(inspect(engine).get_table_names())
    assert 'published_at' in {c['name'] for c in inspect(engine).get_columns('biz_knowledge_documents')}
    command.downgrade(cfg, 'be39d8a2f710')
    assert set(inspect(engine).get_table_names()) == original
command.upgrade(cfg, 'head')
engine.dispose()
"""
    env = {**os.environ, "ORBIT_ENV": "test", "ORBIT_DATABASE_URL": f"sqlite+aiosqlite:///{tmp_path / 'knowledge.db'}"}
    result = subprocess.run(
        [sys.executable, "-c", code],
        cwd=Path(__file__).resolve().parents[1],
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert result.returncode == 0, result.stdout + result.stderr
