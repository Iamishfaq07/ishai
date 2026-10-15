"""linkedin_profiles: LinkedIn AI's read of the user's profile, and their target role

Revision ID: f5b7d9e1a3c4
Revises: e4a6c8b0d2f3
Create Date: 2026-10-15 20:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'f5b7d9e1a3c4'
down_revision: str | Sequence[str] | None = 'e4a6c8b0d2f3'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'linkedin_profiles',
        sa.Column('user_id', sa.String(length=36), nullable=False),
        sa.Column('data', sa.JSON(), nullable=False),
        sa.Column('target_role', sa.String(length=200), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('user_id'),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('linkedin_profiles')
