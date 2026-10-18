"""Orbit Apply (D84): the candidate's setup, answer bank, application packets, proof screenshots and the per-site
kill switch; job_applications.applied_via

Revision ID: 4a93a7c927ef
Revises: b75cd70a02a8
Create Date: 2026-10-19 12:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = '4a93a7c927ef'
down_revision: str | Sequence[str] | None = 'b75cd70a02a8'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TZ = sa.DateTime(timezone=True)


def upgrade() -> None:
    """New tables only, plus one nullable column: nothing existing changes."""
    op.create_table(
        'auto_apply_setups',
        sa.Column('user_id', sa.String(36), sa.ForeignKey('users.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('resume_id', sa.String(36), sa.ForeignKey('resumes.id', ondelete='SET NULL'), nullable=True),
        sa.Column('resume_hash', sa.String(64), nullable=True),
        sa.Column('resume_approved_at', TZ, nullable=True),
        sa.Column('profile', sa.JSON(), nullable=False),
        sa.Column('filters', sa.JSON(), nullable=False),
        sa.Column('mode', sa.String(12), nullable=False),
        sa.Column('daily_limit', sa.Integer(), nullable=False),
        sa.Column('threshold', sa.Integer(), nullable=False),
        sa.Column('ai_line', sa.Boolean(), nullable=False),
        sa.Column('consent_at', TZ, nullable=True),
        sa.Column('consent_version', sa.String(16), nullable=True),
        sa.Column('paused', sa.Boolean(), nullable=False),
        sa.Column('quiet_start', sa.Integer(), nullable=True),
        sa.Column('quiet_end', sa.Integer(), nullable=True),
        sa.Column('tz_offset_min', sa.Integer(), nullable=False),
        sa.Column('last_planned_at', TZ, nullable=True),
        sa.Column('notified_at', TZ, nullable=True),
        sa.Column('updated_at', TZ, nullable=False),
        sa.Column('created_at', TZ, nullable=False),
    )
    op.create_table(
        'answer_bank',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('user_id', sa.String(36), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('key', sa.String(40), nullable=False),
        sa.Column('norm', sa.String(200), nullable=False),
        sa.Column('label', sa.String(500), nullable=False),
        sa.Column('kind', sa.String(12), nullable=False),
        sa.Column('value', sa.Text(), nullable=False),
        sa.Column('legal', sa.Boolean(), nullable=False),
        sa.Column('updated_at', TZ, nullable=False),
        sa.Column('created_at', TZ, nullable=False),
        sa.UniqueConstraint('user_id', 'norm', name='uq_answer_bank_user_norm'),
    )
    op.create_index('ix_answer_bank_user_id', 'answer_bank', ['user_id'])
    op.create_table(
        'application_packets',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('user_id', sa.String(36), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('listing_id', sa.String(36), nullable=False),
        sa.Column('application_id', sa.String(36), sa.ForeignKey('job_applications.id', ondelete='SET NULL'),
                  nullable=True),
        sa.Column('status', sa.String(16), nullable=False),
        sa.Column('ats', sa.String(16), nullable=False),
        sa.Column('tenant', sa.String(160), nullable=False),
        sa.Column('job_ref', sa.String(200), nullable=False),
        sa.Column('site', sa.String(40), nullable=True),
        sa.Column('company', sa.String(200), nullable=False),
        sa.Column('company_key', sa.String(200), nullable=False),
        sa.Column('title', sa.String(300), nullable=False),
        sa.Column('url', sa.Text(), nullable=False),
        sa.Column('apply_url', sa.Text(), nullable=False),
        sa.Column('dedupe_key', sa.String(300), nullable=False),
        sa.Column('match_score', sa.Integer(), nullable=False),
        sa.Column('match_reason', sa.String(500), nullable=False),
        sa.Column('resume_title', sa.String(160), nullable=False),
        sa.Column('resume_data', sa.JSON(), nullable=False),
        sa.Column('resume_diff', sa.JSON(), nullable=False),
        sa.Column('cover_letter', sa.Text(), nullable=True),
        sa.Column('generated', sa.JSON(), nullable=False),
        sa.Column('fields', sa.JSON(), nullable=False),
        sa.Column('answers', sa.JSON(), nullable=False),
        sa.Column('questions', sa.JSON(), nullable=False),
        sa.Column('missing', sa.JSON(), nullable=False),
        sa.Column('form_source', sa.String(12), nullable=False),
        sa.Column('not_before', TZ, nullable=False),
        sa.Column('expires_at', TZ, nullable=False),
        sa.Column('tenant_gap_s', sa.Integer(), nullable=False),
        sa.Column('leased_at', TZ, nullable=True),
        sa.Column('lease_until', TZ, nullable=True),
        sa.Column('attempts', sa.Integer(), nullable=False),
        sa.Column('charge', sa.String(8), nullable=True),
        sa.Column('result_status', sa.String(12), nullable=True),
        sa.Column('result_reason', sa.String(24), nullable=True),
        sa.Column('result_at', TZ, nullable=True),
        sa.Column('reason', sa.String(300), nullable=False),
        sa.Column('unknown_questions', sa.JSON(), nullable=False),
        sa.Column('confirmation_text', sa.Text(), nullable=True),
        sa.Column('final_url', sa.Text(), nullable=True),
        sa.Column('submitted_payload', sa.JSON(), nullable=True),
        sa.Column('submitted_at', TZ, nullable=True),
        sa.Column('updated_at', TZ, nullable=False),
        sa.Column('created_at', TZ, nullable=False),
        sa.UniqueConstraint('user_id', 'listing_id', name='uq_application_packets_user_listing'),
    )
    op.create_index('ix_application_packets_user_id', 'application_packets', ['user_id'])
    op.create_index('ix_application_packets_company_key', 'application_packets', ['company_key'])
    op.create_index('ix_application_packets_user_status', 'application_packets', ['user_id', 'status'])
    op.create_index('ix_application_packets_ats_result', 'application_packets', ['ats', 'result_at'])
    op.create_table(
        'apply_proofs',
        sa.Column('packet_id', sa.String(36), sa.ForeignKey('application_packets.id', ondelete='CASCADE'),
                  primary_key=True),
        sa.Column('user_id', sa.String(36), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('png', sa.LargeBinary(), nullable=False),
        sa.Column('size_bytes', sa.Integer(), nullable=False),
        sa.Column('created_at', TZ, nullable=False),
    )
    op.create_index('ix_apply_proofs_user_id', 'apply_proofs', ['user_id'])
    op.create_table(
        'apply_site_state',
        sa.Column('site', sa.String(16), primary_key=True),
        sa.Column('admin_paused', sa.Boolean(), nullable=False),
        sa.Column('auto_paused_until', TZ, nullable=True),
        sa.Column('reason', sa.String(300), nullable=False),
        sa.Column('updated_at', TZ, nullable=False),
    )
    with op.batch_alter_table('job_applications') as batch:
        batch.add_column(sa.Column('applied_via', sa.String(length=16), nullable=True))


def downgrade() -> None:
    """Drops Orbit Apply's tables (setups, answers, packets and their proof) and the tracker's applied_via."""
    with op.batch_alter_table('job_applications') as batch:
        batch.drop_column('applied_via')
    op.drop_table('apply_site_state')
    op.drop_index('ix_apply_proofs_user_id', table_name='apply_proofs')
    op.drop_table('apply_proofs')
    for name in ('ix_application_packets_ats_result', 'ix_application_packets_user_status',
                 'ix_application_packets_company_key', 'ix_application_packets_user_id'):
        op.drop_index(name, table_name='application_packets')
    op.drop_table('application_packets')
    op.drop_index('ix_answer_bank_user_id', table_name='answer_bank')
    op.drop_table('answer_bank')
    op.drop_table('auto_apply_setups')
