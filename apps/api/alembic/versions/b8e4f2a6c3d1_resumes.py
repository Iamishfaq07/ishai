"""resumes: the resume maker's resumes (content + design JSON, target job post)

Revision ID: b8e4f2a6c3d1
Revises: a7c3e9f1b5d2
Create Date: 2026-09-29 06:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'b8e4f2a6c3d1'
down_revision: str | Sequence[str] | None = 'a7c3e9f1b5d2'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'resumes',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('user_id', sa.String(length=36), nullable=False),
        sa.Column('title', sa.String(length=160), nullable=False),
        sa.Column('data', sa.JSON(), nullable=False),
        sa.Column('design', sa.JSON(), nullable=False),
        sa.Column('job_text', sa.Text(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_resumes_user_id', 'resumes', ['user_id'])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_resumes_user_id', table_name='resumes')
    op.drop_table('resumes')
