"""code_attempts: Code AI's practice attempts and their reviews

Revision ID: a6c8e0f2b4d5
Revises: f5b7d9e1a3c4
Create Date: 2026-10-15 22:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'a6c8e0f2b4d5'
down_revision: str | Sequence[str] | None = 'f5b7d9e1a3c4'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'code_attempts',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('user_id', sa.String(length=36), nullable=False),
        sa.Column('problem_id', sa.String(length=40), nullable=False),
        sa.Column('language', sa.String(length=16), nullable=False),
        sa.Column('code', sa.Text(), nullable=False),
        sa.Column('approach', sa.Text(), nullable=False),
        sa.Column('passed', sa.Integer(), nullable=False),
        sa.Column('total', sa.Integer(), nullable=False),
        sa.Column('solved', sa.Boolean(), nullable=False),
        sa.Column('review', sa.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_code_attempts_user_id', 'code_attempts', ['user_id'])
    op.create_index('ix_code_attempts_user_problem', 'code_attempts', ['user_id', 'problem_id'])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_code_attempts_user_problem', table_name='code_attempts')
    op.drop_index('ix_code_attempts_user_id', table_name='code_attempts')
    op.drop_table('code_attempts')
