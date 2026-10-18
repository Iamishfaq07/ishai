"""orbit for business core (D82): company workspaces, members and invites, jobs, applications, notes, scorecards,
timeline events, interviews, email templates, notifications, job reports and the company audit log

Revision ID: b75cd70a02a8
Revises: 35a47e5f80ca
Create Date: 2026-10-19 00:48:15.310609

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'b75cd70a02a8'
down_revision: str | Sequence[str] | None = '35a47e5f80ca'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema. New tables, and provider_requests.company_id (nullable): nothing that exists changes."""
    with op.batch_alter_table('provider_requests') as batch:
        batch.add_column(sa.Column('company_id', sa.String(length=36), nullable=True))
        batch.create_index('ix_provider_requests_company_id', ['company_id'])
    op.create_table('biz_companies',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('slug', sa.String(length=80), nullable=False),
    sa.Column('name', sa.String(length=120), nullable=False),
    sa.Column('website', sa.String(length=300), nullable=False),
    sa.Column('domain', sa.String(length=253), nullable=False),
    sa.Column('size', sa.String(length=16), nullable=False),
    sa.Column('country', sa.String(length=2), nullable=False),
    sa.Column('about', sa.Text(), nullable=False),
    sa.Column('logo', sa.LargeBinary(), nullable=True),
    sa.Column('logo_type', sa.String(length=16), nullable=True),
    sa.Column('logo_version', sa.Integer(), server_default='0', nullable=False),
    sa.Column('status', sa.String(length=16), server_default='active', nullable=False),
    sa.Column('suspended_reason', sa.String(length=300), nullable=True),
    sa.Column('verified_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('verification_method', sa.String(length=8), nullable=True),
    sa.Column('dns_token', sa.String(length=64), nullable=False),
    sa.Column('email_code_to', sa.String(length=320), nullable=True),
    sa.Column('email_code_hash', sa.String(length=64), nullable=True),
    sa.Column('email_code_until', sa.DateTime(timezone=True), nullable=True),
    sa.Column('email_code_tries', sa.Integer(), server_default='0', nullable=False),
    sa.Column('plan', sa.String(length=16), server_default='free', nullable=False),
    sa.Column('plan_until', sa.DateTime(timezone=True), nullable=True),
    sa.Column('plan_request', sa.String(length=16), nullable=True),
    sa.Column('plan_request_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('retention_months', sa.Integer(), server_default='12', nullable=False),
    sa.Column('blind_review', sa.Boolean(), server_default=sa.text('0'), nullable=False),
    sa.Column('created_by', sa.String(length=36), nullable=True),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('slug')
    )
    with op.batch_alter_table('biz_companies', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_biz_companies_domain'), ['domain'], unique=False)

    op.create_table('biz_audit',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('company_id', sa.String(length=36), nullable=False),
    sa.Column('actor_id', sa.String(length=36), nullable=True),
    sa.Column('actor_name', sa.String(length=200), nullable=True),
    sa.Column('action', sa.String(length=48), nullable=False),
    sa.Column('target', sa.String(length=200), nullable=True),
    sa.Column('detail', sa.JSON(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['company_id'], ['biz_companies.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('biz_audit', schema=None) as batch_op:
        batch_op.create_index('ix_biz_audit_company_created', ['company_id', 'created_at'], unique=False)

    op.create_table('biz_invites',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('company_id', sa.String(length=36), nullable=False),
    sa.Column('email', sa.String(length=320), nullable=False),
    sa.Column('role', sa.String(length=16), nullable=False),
    sa.Column('token_hash', sa.String(length=64), nullable=False),
    sa.Column('invited_by', sa.String(length=36), nullable=True),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('accepted_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['company_id'], ['biz_companies.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('token_hash')
    )
    with op.batch_alter_table('biz_invites', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_biz_invites_company_id'), ['company_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_biz_invites_email'), ['email'], unique=False)

    op.create_table('biz_jobs',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('company_id', sa.String(length=36), nullable=False),
    sa.Column('slug', sa.String(length=120), nullable=False),
    sa.Column('title', sa.String(length=160), nullable=False),
    sa.Column('description_html', sa.Text(), nullable=False),
    sa.Column('department', sa.String(length=80), nullable=False),
    sa.Column('locations', sa.JSON(), nullable=False),
    sa.Column('workplace', sa.String(length=8), nullable=False),
    sa.Column('allowed_countries', sa.JSON(), nullable=False),
    sa.Column('employment_type', sa.String(length=16), nullable=False),
    sa.Column('experience', sa.String(length=8), nullable=False),
    sa.Column('salary_min', sa.BigInteger(), nullable=True),
    sa.Column('salary_max', sa.BigInteger(), nullable=True),
    sa.Column('salary_currency', sa.String(length=3), nullable=False),
    sa.Column('salary_period', sa.String(length=8), nullable=False),
    sa.Column('show_salary', sa.Boolean(), nullable=False),
    sa.Column('must_haves', sa.JSON(), nullable=False),
    sa.Column('nice_to_haves', sa.JSON(), nullable=False),
    sa.Column('questions', sa.JSON(), nullable=False),
    sa.Column('stages', sa.JSON(), nullable=False),
    sa.Column('hiring_team', sa.JSON(), nullable=False),
    sa.Column('status', sa.String(length=8), nullable=False),
    sa.Column('valid_through', sa.DateTime(timezone=True), nullable=True),
    sa.Column('published_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('closed_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('taken_down_reason', sa.String(length=300), nullable=True),
    sa.Column('created_by', sa.String(length=36), nullable=True),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['company_id'], ['biz_companies.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('company_id', 'slug', name='uq_biz_jobs_company_slug')
    )
    with op.batch_alter_table('biz_jobs', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_biz_jobs_company_id'), ['company_id'], unique=False)
        batch_op.create_index('ix_biz_jobs_status', ['status'], unique=False)

    op.create_table('biz_members',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('company_id', sa.String(length=36), nullable=False),
    sa.Column('user_id', sa.String(length=36), nullable=False),
    sa.Column('role', sa.String(length=16), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['company_id'], ['biz_companies.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('company_id', 'user_id', name='uq_biz_members_company_user')
    )
    with op.batch_alter_table('biz_members', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_biz_members_company_id'), ['company_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_biz_members_user_id'), ['user_id'], unique=False)

    op.create_table('biz_templates',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('company_id', sa.String(length=36), nullable=False),
    sa.Column('kind', sa.String(length=12), nullable=False),
    sa.Column('subject', sa.String(length=200), nullable=False),
    sa.Column('body', sa.Text(), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['company_id'], ['biz_companies.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('company_id', 'kind', name='uq_biz_templates_company_kind')
    )
    with op.batch_alter_table('biz_templates', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_biz_templates_company_id'), ['company_id'], unique=False)

    op.create_table('biz_applications',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('reference', sa.String(length=12), nullable=False),
    sa.Column('company_id', sa.String(length=36), nullable=False),
    sa.Column('job_id', sa.String(length=36), nullable=False),
    sa.Column('user_id', sa.String(length=36), nullable=True),
    sa.Column('name', sa.String(length=160), nullable=False),
    sa.Column('email', sa.String(length=320), nullable=False),
    sa.Column('phone', sa.String(length=40), nullable=True),
    sa.Column('location', sa.String(length=160), nullable=True),
    sa.Column('resume_text', sa.Text(), nullable=False),
    sa.Column('resume_filename', sa.String(length=200), nullable=True),
    sa.Column('resume_source', sa.String(length=16), nullable=False),
    sa.Column('answers', sa.JSON(), nullable=False),
    sa.Column('knockout_failed', sa.Boolean(), nullable=False),
    sa.Column('knockout_reasons', sa.JSON(), nullable=False),
    sa.Column('source', sa.String(length=16), nullable=False),
    sa.Column('consent', sa.JSON(), nullable=False),
    sa.Column('email_confirmed_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('status_token_hash', sa.String(length=64), nullable=False),
    sa.Column('stage_id', sa.String(length=16), nullable=False),
    sa.Column('status', sa.String(length=10), nullable=False),
    sa.Column('stage_changed_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('rejected_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('first_response_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('tags', sa.JSON(), nullable=False),
    sa.Column('interviewers', sa.JSON(), nullable=False),
    sa.Column('parsed', sa.JSON(none_as_null=True), nullable=True),
    sa.Column('ranking', sa.JSON(none_as_null=True), nullable=True),
    sa.Column('ranking_status', sa.String(length=8), nullable=False),
    sa.Column('ranking_model', sa.String(length=120), nullable=True),
    sa.Column('tracker_id', sa.String(length=36), nullable=True),
    sa.Column('deletion_requested_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['company_id'], ['biz_companies.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['job_id'], ['biz_jobs.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('job_id', 'email', name='uq_biz_applications_job_email'),
    sa.UniqueConstraint('reference'),
    sa.UniqueConstraint('status_token_hash')
    )
    with op.batch_alter_table('biz_applications', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_biz_applications_company_id'), ['company_id'], unique=False)
        batch_op.create_index('ix_biz_applications_company_status', ['company_id', 'status'], unique=False)
        batch_op.create_index(batch_op.f('ix_biz_applications_job_id'), ['job_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_biz_applications_user_id'), ['user_id'], unique=False)

    op.create_table('biz_reports',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('company_id', sa.String(length=36), nullable=False),
    sa.Column('job_id', sa.String(length=36), nullable=False),
    sa.Column('reason', sa.String(length=16), nullable=False),
    sa.Column('details', sa.Text(), nullable=False),
    sa.Column('email', sa.String(length=320), nullable=True),
    sa.Column('status', sa.String(length=10), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['company_id'], ['biz_companies.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['job_id'], ['biz_jobs.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('biz_reports', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_biz_reports_company_id'), ['company_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_biz_reports_job_id'), ['job_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_biz_reports_status'), ['status'], unique=False)

    op.create_table('biz_events',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('company_id', sa.String(length=36), nullable=False),
    sa.Column('job_id', sa.String(length=36), nullable=False),
    sa.Column('application_id', sa.String(length=36), nullable=False),
    sa.Column('kind', sa.String(length=24), nullable=False),
    sa.Column('data', sa.JSON(), nullable=False),
    sa.Column('actor_id', sa.String(length=36), nullable=True),
    sa.Column('actor_name', sa.String(length=200), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['application_id'], ['biz_applications.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['company_id'], ['biz_companies.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('biz_events', schema=None) as batch_op:
        batch_op.create_index('ix_biz_events_application_created', ['application_id', 'created_at'], unique=False)
        batch_op.create_index(batch_op.f('ix_biz_events_company_id'), ['company_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_biz_events_job_id'), ['job_id'], unique=False)

    op.create_table('biz_interviews',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('company_id', sa.String(length=36), nullable=False),
    sa.Column('application_id', sa.String(length=36), nullable=False),
    sa.Column('slots', sa.JSON(), nullable=False),
    sa.Column('duration_min', sa.Integer(), nullable=False),
    sa.Column('location', sa.String(length=300), nullable=False),
    sa.Column('chosen', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_by', sa.String(length=36), nullable=True),
    sa.Column('reply_to', sa.String(length=320), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['application_id'], ['biz_applications.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['company_id'], ['biz_companies.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('biz_interviews', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_biz_interviews_application_id'), ['application_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_biz_interviews_company_id'), ['company_id'], unique=False)

    op.create_table('biz_notes',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('company_id', sa.String(length=36), nullable=False),
    sa.Column('application_id', sa.String(length=36), nullable=False),
    sa.Column('author_id', sa.String(length=36), nullable=True),
    sa.Column('author_name', sa.String(length=200), nullable=False),
    sa.Column('body', sa.Text(), nullable=False),
    sa.Column('mentions', sa.JSON(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['application_id'], ['biz_applications.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['company_id'], ['biz_companies.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('biz_notes', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_biz_notes_application_id'), ['application_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_biz_notes_company_id'), ['company_id'], unique=False)

    op.create_table('biz_notifications',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('user_id', sa.String(length=36), nullable=False),
    sa.Column('company_id', sa.String(length=36), nullable=False),
    sa.Column('application_id', sa.String(length=36), nullable=True),
    sa.Column('kind', sa.String(length=16), nullable=False),
    sa.Column('text', sa.String(length=400), nullable=False),
    sa.Column('read_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['application_id'], ['biz_applications.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['company_id'], ['biz_companies.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('biz_notifications', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_biz_notifications_company_id'), ['company_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_biz_notifications_user_id'), ['user_id'], unique=False)

    op.create_table('biz_scorecards',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('company_id', sa.String(length=36), nullable=False),
    sa.Column('application_id', sa.String(length=36), nullable=False),
    sa.Column('stage_id', sa.String(length=16), nullable=False),
    sa.Column('author_id', sa.String(length=36), nullable=True),
    sa.Column('author_name', sa.String(length=200), nullable=False),
    sa.Column('ratings', sa.JSON(), nullable=False),
    sa.Column('notes', sa.Text(), nullable=False),
    sa.Column('recommendation', sa.String(length=8), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['application_id'], ['biz_applications.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['company_id'], ['biz_companies.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('application_id', 'stage_id', 'author_id', name='uq_biz_scorecards_one_each')
    )
    with op.batch_alter_table('biz_scorecards', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_biz_scorecards_application_id'), ['application_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_biz_scorecards_company_id'), ['company_id'], unique=False)





def downgrade() -> None:
    """Downgrade schema. Every Orbit for Business table and its data is dropped."""
    with op.batch_alter_table('provider_requests') as batch:
        batch.drop_index('ix_provider_requests_company_id')
        batch.drop_column('company_id')


    with op.batch_alter_table('biz_scorecards', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_biz_scorecards_company_id'))
        batch_op.drop_index(batch_op.f('ix_biz_scorecards_application_id'))

    op.drop_table('biz_scorecards')
    with op.batch_alter_table('biz_notifications', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_biz_notifications_user_id'))
        batch_op.drop_index(batch_op.f('ix_biz_notifications_company_id'))

    op.drop_table('biz_notifications')
    with op.batch_alter_table('biz_notes', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_biz_notes_company_id'))
        batch_op.drop_index(batch_op.f('ix_biz_notes_application_id'))

    op.drop_table('biz_notes')
    with op.batch_alter_table('biz_interviews', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_biz_interviews_company_id'))
        batch_op.drop_index(batch_op.f('ix_biz_interviews_application_id'))

    op.drop_table('biz_interviews')
    with op.batch_alter_table('biz_events', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_biz_events_job_id'))
        batch_op.drop_index(batch_op.f('ix_biz_events_company_id'))
        batch_op.drop_index('ix_biz_events_application_created')

    op.drop_table('biz_events')
    with op.batch_alter_table('biz_reports', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_biz_reports_status'))
        batch_op.drop_index(batch_op.f('ix_biz_reports_job_id'))
        batch_op.drop_index(batch_op.f('ix_biz_reports_company_id'))

    op.drop_table('biz_reports')
    with op.batch_alter_table('biz_applications', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_biz_applications_user_id'))
        batch_op.drop_index(batch_op.f('ix_biz_applications_job_id'))
        batch_op.drop_index('ix_biz_applications_company_status')
        batch_op.drop_index(batch_op.f('ix_biz_applications_company_id'))

    op.drop_table('biz_applications')
    with op.batch_alter_table('biz_templates', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_biz_templates_company_id'))

    op.drop_table('biz_templates')
    with op.batch_alter_table('biz_members', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_biz_members_user_id'))
        batch_op.drop_index(batch_op.f('ix_biz_members_company_id'))

    op.drop_table('biz_members')
    with op.batch_alter_table('biz_jobs', schema=None) as batch_op:
        batch_op.drop_index('ix_biz_jobs_status')
        batch_op.drop_index(batch_op.f('ix_biz_jobs_company_id'))

    op.drop_table('biz_jobs')
    with op.batch_alter_table('biz_invites', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_biz_invites_email'))
        batch_op.drop_index(batch_op.f('ix_biz_invites_company_id'))

    op.drop_table('biz_invites')
    with op.batch_alter_table('biz_audit', schema=None) as batch_op:
        batch_op.drop_index('ix_biz_audit_company_created')

    op.drop_table('biz_audit')
    with op.batch_alter_table('biz_companies', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_biz_companies_domain'))

    op.drop_table('biz_companies')
