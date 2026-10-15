"""job mission room: resume snapshots per tracked job, and an offer's link to its tracked job

Revision ID: b7d9f1a3c5e7
Revises: a6c8e0f2b4d5
Create Date: 2026-10-16 09:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'b7d9f1a3c5e7'
down_revision: str | Sequence[str] | None = 'a6c8e0f2b4d5'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'resume_snapshots',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('user_id', sa.String(length=36), nullable=False),
        sa.Column('application_id', sa.String(length=36), nullable=False),
        sa.Column('resume_id', sa.String(length=36), nullable=True),
        sa.Column('title', sa.String(length=160), nullable=False),
        sa.Column('data', sa.JSON(), nullable=False),
        sa.Column('design', sa.JSON(), nullable=False),
        sa.Column('job_text', sa.Text(), nullable=False),
        sa.Column('score', sa.Integer(), nullable=False),
        sa.Column('note', sa.String(length=200), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['application_id'], ['job_applications.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['resume_id'], ['resumes.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_resume_snapshots_user_id', 'resume_snapshots', ['user_id'])
    op.create_index('ix_resume_snapshots_application_id', 'resume_snapshots', ['application_id'])
    with op.batch_alter_table('job_offers') as batch:
        batch.add_column(sa.Column('application_id', sa.String(length=36), nullable=True))
        batch.create_index('ix_job_offers_application_id', ['application_id'])
        batch.create_foreign_key('fk_job_offers_application_id', 'job_applications', ['application_id'], ['id'],
                                 ondelete='SET NULL')


def downgrade() -> None:
    """Downgrade schema. The link is dropped (the offers stay); the snapshots go with their table."""
    with op.batch_alter_table('job_offers') as batch:
        batch.drop_constraint('fk_job_offers_application_id', type_='foreignkey')
        batch.drop_index('ix_job_offers_application_id')
        batch.drop_column('application_id')
    op.drop_index('ix_resume_snapshots_application_id', table_name='resume_snapshots')
    op.drop_index('ix_resume_snapshots_user_id', table_name='resume_snapshots')
    op.drop_table('resume_snapshots')
