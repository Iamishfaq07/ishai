"""interview day: a session's link to its tracked job; the tracked job's next round, resume version and likely
questions; who made a document (the user, or Orbit for a practice round or a session)

Revision ID: 35a47e5f80ca
Revises: 467956f519dd
Create Date: 2026-10-18 12:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = '35a47e5f80ca'
down_revision: str | Sequence[str] | None = '467956f519dd'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema. Nullable or defaulted: existing sessions, tracked jobs and documents are unchanged."""
    with op.batch_alter_table('sessions') as batch:
        batch.add_column(sa.Column('application_id', sa.String(length=36), nullable=True))
        batch.create_index('ix_sessions_application_id', ['application_id'])
        batch.create_foreign_key('fk_sessions_application_id', 'job_applications', ['application_id'], ['id'],
                                 ondelete='SET NULL')
    with op.batch_alter_table('job_applications') as batch:
        batch.add_column(sa.Column('round_type', sa.String(length=16), nullable=True))
        batch.add_column(sa.Column('round_number', sa.Integer(), nullable=True))
        batch.add_column(sa.Column('interview_version', sa.String(length=36), nullable=True))
        batch.add_column(sa.Column('interview_questions', sa.JSON(), nullable=True))
    with op.batch_alter_table('documents') as batch:
        batch.add_column(sa.Column('origin', sa.String(length=8), nullable=False, server_default='user'))


def downgrade() -> None:
    """Downgrade schema. The links, rounds and stored questions are dropped; sessions, jobs and documents stay (a
    document Orbit saved then counts like any other)."""
    with op.batch_alter_table('documents') as batch:
        batch.drop_column('origin')
    with op.batch_alter_table('job_applications') as batch:
        batch.drop_column('interview_questions')
        batch.drop_column('interview_version')
        batch.drop_column('round_number')
        batch.drop_column('round_type')
    with op.batch_alter_table('sessions') as batch:
        batch.drop_constraint('fk_sessions_application_id', type_='foreignkey')
        batch.drop_index('ix_sessions_application_id')
        batch.drop_column('application_id')
