"""Saved role playbooks and dependency-aware internal workflow runs."""

import sqlalchemy as sa

from alembic import op

revision = "f2b6c8d0e5a7"
down_revision = "e1a5b7c9d4f6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "biz_workflow_plans",
        sa.Column("job_id", sa.String(36), sa.ForeignKey("biz_jobs.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("content", sa.JSON(), nullable=False),
    )
    op.create_table(
        "biz_workflow_runs",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("company_id", sa.String(36), sa.ForeignKey("biz_companies.id", ondelete="CASCADE"), nullable=False),
        sa.Column("job_id", sa.String(36), sa.ForeignKey("biz_jobs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("request_sha256", sa.String(64), nullable=False),
        sa.Column("plan_revision", sa.Integer(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("start_date", sa.String(10), nullable=False),
        sa.Column("content", sa.JSON(), nullable=False),
        sa.Column("tasks", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    for col in ("company_id", "job_id"):
        op.create_index(f"ix_biz_workflow_runs_{col}", "biz_workflow_runs", [col])


def downgrade() -> None:
    op.drop_table("biz_workflow_runs")
    op.drop_table("biz_workflow_plans")
