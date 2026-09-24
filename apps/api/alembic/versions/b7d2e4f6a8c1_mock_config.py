"""sessions.mock_config for AI mock interviews

Revision ID: b7d2e4f6a8c1
Revises: a1f3c7e9d2b5
Create Date: 2026-09-25 14:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'b7d2e4f6a8c1'
down_revision: str | Sequence[str] | None = 'a1f3c7e9d2b5'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table('sessions', schema=None) as batch_op:
        batch_op.add_column(sa.Column('mock_config', sa.JSON(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('sessions', schema=None) as batch_op:
        batch_op.drop_column('mock_config')
