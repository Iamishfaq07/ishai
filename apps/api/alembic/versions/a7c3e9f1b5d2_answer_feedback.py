"""answer_feedback: the user's thumbs up/down (and why) on live answers

Revision ID: a7c3e9f1b5d2
Revises: f6b2d8e4a1c9
Create Date: 2026-09-26 08:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'a7c3e9f1b5d2'
down_revision: str | Sequence[str] | None = 'f6b2d8e4a1c9'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'answer_feedback',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('user_id', sa.String(length=36), nullable=False),
        sa.Column('session_id', sa.String(length=36), nullable=False),
        sa.Column('answer_id', sa.String(length=36), nullable=False),
        sa.Column('rating', sa.String(length=8), nullable=False),
        sa.Column('reason', sa.String(length=32), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['session_id'], ['sessions.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('answer_id'),
    )
    op.create_index('ix_answer_feedback_user_id', 'answer_feedback', ['user_id'])
    op.create_index('ix_answer_feedback_session_id', 'answer_feedback', ['session_id'])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_answer_feedback_session_id', table_name='answer_feedback')
    op.drop_index('ix_answer_feedback_user_id', table_name='answer_feedback')
    op.drop_table('answer_feedback')
