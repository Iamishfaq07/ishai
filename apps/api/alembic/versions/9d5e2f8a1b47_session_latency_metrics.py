"""live-latency samples on sessions

Revision ID: 9d5e2f8a1b47
Revises: 8c4d1e7f2a30
Create Date: 2026-09-24 23:30:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = '9d5e2f8a1b47'
down_revision: str | Sequence[str] | None = '8c4d1e7f2a30'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table('sessions', schema=None) as batch_op:
        batch_op.add_column(sa.Column('metrics', sa.JSON(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('sessions', schema=None) as batch_op:
        batch_op.drop_column('metrics')
