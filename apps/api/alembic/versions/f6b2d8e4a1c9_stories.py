"""stories: the candidate's story bank (STAR examples reused across interviews)

Revision ID: f6b2d8e4a1c9
Revises: e5a1c7d3b9f2
Create Date: 2026-09-26 06:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa

import orbit_api.db
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'f6b2d8e4a1c9'
down_revision: str | Sequence[str] | None = 'e5a1c7d3b9f2'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'stories',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('user_id', sa.String(length=36), nullable=False),
        sa.Column('title', sa.String(length=160), nullable=False),
        sa.Column('situation', sa.Text(), nullable=False),
        sa.Column('task', sa.Text(), nullable=False),
        sa.Column('action', sa.Text(), nullable=False),
        sa.Column('result', sa.Text(), nullable=False),
        sa.Column('competencies', sa.JSON(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('embedding', orbit_api.db.EmbeddingType(), nullable=True),
        sa.Column('embedding_model', sa.String(length=64), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_stories_user_id', 'stories', ['user_id'])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_stories_user_id', table_name='stories')
    op.drop_table('stories')
