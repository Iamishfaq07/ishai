"""jobs: cached job listings and their sources' fetch state, a job-search profile per user, the tracker, fit checks

The Jobs page (orbit_api/job_portal) ranks job posts from public sources against the user's resume. Listings are
cached here (shared, refreshed in the background), with each source's last fetch, back-off and quota counts. Each user
has one search profile (read from a resume, then edited), their tracked jobs (saved → applied → interviewing → offer /
rejected, with a copy of the job's details since listings are dropped after ~30 days), and their AI fit checks, kept
so asking again is free. All new tables: nothing existing changes.

Revision ID: e9b4c6a2d8f1
Revises: cd1a7385ee32
Create Date: 2026-10-07 09:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'e9b4c6a2d8f1'
down_revision: str | Sequence[str] | None = 'cd1a7385ee32'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'job_listings',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('source', sa.String(length=24), nullable=False),
        sa.Column('external_id', sa.String(length=200), nullable=False),
        sa.Column('board', sa.String(length=160), nullable=False),
        sa.Column('company', sa.String(length=200), nullable=False),
        sa.Column('title', sa.String(length=300), nullable=False),
        sa.Column('locations', sa.JSON(), nullable=False),
        sa.Column('cities', sa.JSON(), nullable=False),
        sa.Column('country', sa.String(length=2), nullable=True),
        sa.Column('workplace', sa.String(length=16), nullable=True),
        sa.Column('employment_type', sa.String(length=16), nullable=True),
        sa.Column('level', sa.String(length=16), nullable=True),
        sa.Column('exp_min', sa.Integer(), nullable=True),
        sa.Column('exp_max', sa.Integer(), nullable=True),
        sa.Column('posted_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('url', sa.Text(), nullable=False),
        sa.Column('apply_url', sa.Text(), nullable=False),
        sa.Column('snippet', sa.Text(), nullable=False),
        sa.Column('description', sa.Text(), nullable=False),
        sa.Column('salary', sa.String(length=120), nullable=True),
        sa.Column('keywords', sa.JSON(), nullable=False),
        sa.Column('text_hash', sa.String(length=16), nullable=True),
        sa.Column('dedupe_key', sa.String(length=300), nullable=False),
        sa.Column('fetched_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('source', 'external_id', name='uq_job_listings_source_external'),
    )
    op.create_index('ix_job_listings_dedupe_key', 'job_listings', ['dedupe_key'])
    op.create_index('ix_job_listings_posted_at', 'job_listings', ['posted_at'])
    op.create_index('ix_job_listings_source_board', 'job_listings', ['source', 'board'])

    op.create_table(
        'job_source_state',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('source', sa.String(length=24), nullable=False),
        sa.Column('key', sa.String(length=160), nullable=False),
        sa.Column('last_attempt_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('last_success_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('last_error', sa.String(length=300), nullable=True),
        sa.Column('listings', sa.Integer(), nullable=False),
        sa.Column('failures', sa.Integer(), nullable=False),
        sa.Column('retry_after', sa.DateTime(timezone=True), nullable=True),
        sa.Column('requested_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('day', sa.String(length=10), nullable=True),
        sa.Column('day_calls', sa.Integer(), nullable=False),
        sa.Column('month', sa.String(length=7), nullable=True),
        sa.Column('month_calls', sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('source', 'key', name='uq_job_source_state_source_key'),
    )

    op.create_table(
        'job_search_profiles',
        sa.Column('user_id', sa.String(length=36), nullable=False),
        sa.Column('resume_id', sa.String(length=36), nullable=True),
        sa.Column('prefs', sa.JSON(), nullable=False),
        sa.Column('suggested', sa.JSON(), nullable=True),
        sa.Column('suggested_hash', sa.String(length=64), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['resume_id'], ['resumes.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('user_id'),
    )
    op.create_index('ix_job_search_profiles_resume_id', 'job_search_profiles', ['resume_id'])

    op.create_table(
        'job_applications',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('user_id', sa.String(length=36), nullable=False),
        sa.Column('listing_id', sa.String(length=36), nullable=False),
        sa.Column('source', sa.String(length=24), nullable=False),
        sa.Column('company', sa.String(length=200), nullable=False),
        sa.Column('title', sa.String(length=300), nullable=False),
        sa.Column('location', sa.String(length=300), nullable=False),
        sa.Column('url', sa.Text(), nullable=False),
        sa.Column('apply_url', sa.Text(), nullable=False),
        sa.Column('posted_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('status', sa.String(length=16), nullable=False),
        sa.Column('notes', sa.Text(), nullable=False),
        sa.Column('applied_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('next_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('status_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('resume_id', sa.String(length=36), nullable=True),
        sa.Column('document_id', sa.String(length=36), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['document_id'], ['documents.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['resume_id'], ['resumes.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id', 'listing_id', name='uq_job_applications_user_listing'),
    )
    op.create_index('ix_job_applications_user_id', 'job_applications', ['user_id'])
    op.create_index('ix_job_applications_resume_id', 'job_applications', ['resume_id'])
    op.create_index('ix_job_applications_document_id', 'job_applications', ['document_id'])

    op.create_table(
        'job_fit_checks',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('user_id', sa.String(length=36), nullable=False),
        sa.Column('listing_id', sa.String(length=36), nullable=False),
        sa.Column('resume_hash', sa.String(length=64), nullable=False),
        sa.Column('result', sa.JSON(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id', 'listing_id', 'resume_hash', name='uq_job_fit_checks_key'),
    )
    op.create_index('ix_job_fit_checks_user_created', 'job_fit_checks', ['user_id', 'created_at'])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_job_fit_checks_user_created', table_name='job_fit_checks')
    op.drop_table('job_fit_checks')
    op.drop_index('ix_job_applications_document_id', table_name='job_applications')
    op.drop_index('ix_job_applications_resume_id', table_name='job_applications')
    op.drop_index('ix_job_applications_user_id', table_name='job_applications')
    op.drop_table('job_applications')
    op.drop_index('ix_job_search_profiles_resume_id', table_name='job_search_profiles')
    op.drop_table('job_search_profiles')
    op.drop_table('job_source_state')
    op.drop_index('ix_job_listings_source_board', table_name='job_listings')
    op.drop_index('ix_job_listings_posted_at', table_name='job_listings')
    op.drop_index('ix_job_listings_dedupe_key', table_name='job_listings')
    op.drop_table('job_listings')
