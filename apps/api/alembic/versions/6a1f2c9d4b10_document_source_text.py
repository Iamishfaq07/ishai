"""document source_text for in-place editing

Revision ID: 6a1f2c9d4b10
Revises: 530435220f40
Create Date: 2026-09-24 12:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = '6a1f2c9d4b10'
down_revision: str | Sequence[str] | None = '530435220f40'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table('documents', schema=None) as batch_op:
        batch_op.add_column(sa.Column('source_text', sa.Text(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('documents', schema=None) as batch_op:
        batch_op.drop_column('source_text')
