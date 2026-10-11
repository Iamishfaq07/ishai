"""job contacts: the people in a job search (Jobs AI → Outreach → People)

One new table, `job_contacts` (orbit_api/job_portal/contacts.py): a referrer, recruiter, alum or hiring manager the
user is in touch with: their name, company, title, how the user knows them, how to reach them (LinkedIn, email,
phone), notes, when they were last contacted and when to follow up, and optionally the tracked job they're about
(SET NULL, so removing the job keeps the person). Nothing existing changes.

Revision ID: d2c4e6a8f0b1
Revises: b5d7e9f1a3c6
Create Date: 2026-10-11 18:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'd2c4e6a8f0b1'
down_revision: str | Sequence[str] | None = 'b5d7e9f1a3c6'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'job_contacts',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('user_id', sa.String(length=36), nullable=False),
        sa.Column('name', sa.String(length=120), nullable=False),
        sa.Column('company', sa.String(length=200), nullable=False),
        sa.Column('title', sa.String(length=200), nullable=False),
        sa.Column('relation', sa.String(length=24), nullable=False),
        sa.Column('linkedin_url', sa.Text(), nullable=True),
        sa.Column('email', sa.String(length=320), nullable=True),
        sa.Column('phone', sa.String(length=32), nullable=True),
        sa.Column('notes', sa.Text(), nullable=False),
        sa.Column('application_id', sa.String(length=36), nullable=True),
        sa.Column('last_contacted_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('follow_up_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['application_id'], ['job_applications.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_job_contacts_user_id', 'job_contacts', ['user_id'])
    op.create_index('ix_job_contacts_application_id', 'job_contacts', ['application_id'])
    op.create_index('ix_job_contacts_user_follow_up', 'job_contacts', ['user_id', 'follow_up_at'])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_job_contacts_user_follow_up', table_name='job_contacts')
    op.drop_index('ix_job_contacts_application_id', table_name='job_contacts')
    op.drop_index('ix_job_contacts_user_id', table_name='job_contacts')
    op.drop_table('job_contacts')
