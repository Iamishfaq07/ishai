"""users.approved / grant_plan / grant_until: sign-up approval and time-limited plan grants

Revision ID: d2a6f8c4e9b1
Revises: c9d4e7a2f1b8
Create Date: 2026-09-30 18:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'd2a6f8c4e9b1'
down_revision: str | Sequence[str] | None = 'c9d4e7a2f1b8'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema. Existing accounts are approved: approval applies to sign-ups from now on."""
    op.add_column('users', sa.Column('approved', sa.Boolean(), nullable=False, server_default=sa.true()))
    op.add_column('users', sa.Column('grant_plan', sa.String(length=32), nullable=True))
    op.add_column('users', sa.Column('grant_until', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('users') as batch:
        batch.drop_column('grant_until')
        batch.drop_column('grant_plan')
        batch.drop_column('approved')
