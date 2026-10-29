"""Application-linked talent consent and reviewed role suggestions."""

import sqlalchemy as sa

from alembic import op

revision = "d0f4a6b8c3e5"
down_revision = "c9e3f5a7b2d4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "biz_talent_pools",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("company_id", sa.String(36), sa.ForeignKey("biz_companies.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("purpose", sa.String(1200), nullable=False),
        sa.Column("retention_days", sa.Integer(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("terms_revision", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_biz_talent_pools_company_id", "biz_talent_pools", ["company_id"])
    op.create_table(
        "biz_talent_members",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("pool_id", sa.String(36), sa.ForeignKey("biz_talent_pools.id", ondelete="CASCADE"), nullable=False),
        sa.Column(
            "application_id", sa.String(36), sa.ForeignKey("biz_applications.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("terms_revision", sa.Integer(), nullable=False),
        sa.Column("request_id", sa.String(36), nullable=False),
        sa.Column("notice_sha256", sa.String(64), nullable=False),
        sa.Column("notice_version", sa.String(40), nullable=False),
        sa.Column("skills", sa.JSON(), nullable=False),
        sa.Column("interests", sa.String(600), nullable=False),
        sa.Column("search_text", sa.Text(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consented_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("pool_id", "application_id", name="uq_biz_talent_pool_application"),
    )
    for col in ("pool_id", "application_id", "expires_at"):
        op.create_index(f"ix_biz_talent_members_{col}", "biz_talent_members", [col])
    op.create_table(
        "biz_talent_suggestions",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "member_id", sa.String(36), sa.ForeignKey("biz_talent_members.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("job_id", sa.String(36), sa.ForeignKey("biz_jobs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("member_id", "job_id", name="uq_biz_talent_member_job"),
    )
    for col in ("member_id", "job_id"):
        op.create_index(f"ix_biz_talent_suggestions_{col}", "biz_talent_suggestions", [col])


def downgrade() -> None:
    for table in ("biz_talent_suggestions", "biz_talent_members", "biz_talent_pools"):
        op.drop_table(table)
