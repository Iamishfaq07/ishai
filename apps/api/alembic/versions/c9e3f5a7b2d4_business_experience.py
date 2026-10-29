"""Opt-in candidate experience campaigns, private responses and non-overlapping reporting groups."""

import sqlalchemy as sa

from alembic import op

revision = "c9e3f5a7b2d4"
down_revision = "c3e5a7b9d1f4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "biz_experience_campaigns",
        sa.Column("job_id", sa.String(36), sa.ForeignKey("biz_jobs.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("company_id", sa.String(36), sa.ForeignKey("biz_companies.id", ondelete="CASCADE"), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("stage_kinds", sa.JSON(), nullable=False),
        sa.Column("expiry_days", sa.Integer(), nullable=False),
        sa.Column("plan", sa.JSON(), nullable=False),
    )
    op.create_index("ix_biz_experience_campaigns_company_id", "biz_experience_campaigns", ["company_id"])
    op.create_index("ix_biz_experience_campaigns_enabled_job", "biz_experience_campaigns", ["enabled", "job_id"])
    op.create_table(
        "biz_experience_invites",
        sa.Column(
            "application_id", sa.String(36), sa.ForeignKey("biz_applications.id", ondelete="CASCADE"), primary_key=True
        ),
        sa.Column("company_id", sa.String(36), sa.ForeignKey("biz_companies.id", ondelete="CASCADE"), nullable=False),
        sa.Column("job_id", sa.String(36), sa.ForeignKey("biz_jobs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("survey_version", sa.String(40), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("responded_at", sa.DateTime(timezone=True)),
        sa.Column("withdrawn_at", sa.DateTime(timezone=True)),
        sa.Column("response_request_id", sa.String(36)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    for column in ("company_id", "job_id"):
        op.create_index(f"ix_biz_experience_invites_{column}", "biz_experience_invites", [column])
    op.create_table(
        "biz_experience_batches",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("job_id", sa.String(36), sa.ForeignKey("biz_jobs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_biz_experience_batches_job_id", "biz_experience_batches", ["job_id"])
    op.create_table(
        "biz_experience_responses",
        sa.Column(
            "application_id",
            sa.String(36),
            sa.ForeignKey("biz_experience_invites.application_id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("batch_id", sa.String(36), sa.ForeignKey("biz_experience_batches.id", ondelete="CASCADE")),
        sa.Column("ratings", sa.JSON(), nullable=False),
        sa.Column("improvement", sa.String(24), nullable=False),
        sa.Column("notice_sha256", sa.String(64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_biz_experience_responses_batch_id", "biz_experience_responses", ["batch_id"])
    op.create_index("ix_biz_experience_responses_created_at", "biz_experience_responses", ["created_at"])


def downgrade() -> None:
    for table in (
        "biz_experience_responses",
        "biz_experience_batches",
        "biz_experience_invites",
        "biz_experience_campaigns",
    ):
        op.drop_table(table)
