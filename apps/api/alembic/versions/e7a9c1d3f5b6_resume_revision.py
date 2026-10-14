"""Resume revisions: every save bumps one, and a save based on an older revision is refused (V3-06).

Revision ID: e7a9c1d3f5b6
Revises: d5f7b9c1e3a4
Create Date: 2026-10-14 21:30:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "e7a9c1d3f5b6"
down_revision: str | Sequence[str] | None = "d5f7b9c1e3a4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("resumes", schema=None) as batch_op:
        batch_op.add_column(sa.Column("revision", sa.Integer(), nullable=False, server_default="0"))


def downgrade() -> None:
    with op.batch_alter_table("resumes", schema=None) as batch_op:
        batch_op.drop_column("revision")
