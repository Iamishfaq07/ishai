"""saved answers: the answer bank (Story bank → My answers)

One new table, `saved_answers` (orbit_api/answers/routes.py): a question and the user's own answer to it, often saved
from a session review's "Try saying" and edited, loaded into every live session as the stories are. `session_id` is
the session it was saved from (SET NULL, so deleting the session keeps the answer). Nothing existing changes.

Revision ID: e4b6d8f0a2c3
Revises: d2c4e6a8f0b1
Create Date: 2026-10-11 21:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa

import orbit_api.db
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'e4b6d8f0a2c3'
down_revision: str | Sequence[str] | None = 'd2c4e6a8f0b1'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'saved_answers',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('user_id', sa.String(length=36), nullable=False),
        sa.Column('question', sa.Text(), nullable=False),
        sa.Column('answer', sa.Text(), nullable=False),
        sa.Column('session_id', sa.String(length=36), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('embedding', orbit_api.db.EmbeddingType(), nullable=True),
        sa.Column('embedding_model', sa.String(length=64), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['session_id'], ['sessions.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_saved_answers_user_id', 'saved_answers', ['user_id'])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_saved_answers_user_id', table_name='saved_answers')
    op.drop_table('saved_answers')
