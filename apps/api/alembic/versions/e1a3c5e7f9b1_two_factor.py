"""user_two_factor: two-step sign-in with an authenticator app (encrypted secret, hashed recovery codes)

Revision ID: e1a3c5e7f9b1
Revises: d9f1b3c5e7a9
Create Date: 2026-10-16 17:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'e1a3c5e7f9b1'
down_revision: str | Sequence[str] | None = 'd9f1b3c5e7a9'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'user_two_factor',
        sa.Column('user_id', sa.String(length=36), nullable=False),
        sa.Column('secret_enc', sa.Text(), nullable=False),
        sa.Column('enabled_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('last_step', sa.BigInteger(), nullable=True),
        sa.Column('recovery_hashes', sa.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('user_id'),
    )


def downgrade() -> None:
    """Downgrade schema (two-step sign-in is off for everyone after this)."""
    op.drop_table('user_two_factor')
