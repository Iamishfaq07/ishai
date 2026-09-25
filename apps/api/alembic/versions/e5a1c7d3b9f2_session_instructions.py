"""sessions.instructions: the candidate's standing instructions for answers

Revision ID: e5a1c7d3b9f2
Revises: d4f9b2c6e1a3
Create Date: 2026-09-25 22:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'e5a1c7d3b9f2'
down_revision: str | Sequence[str] | None = 'd4f9b2c6e1a3'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table('sessions', schema=None) as batch_op:
        batch_op.add_column(sa.Column('instructions', sa.Text(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('sessions', schema=None) as batch_op:
        batch_op.drop_column('instructions')
