"""Structured interview evidence and practical work samples.

Revision ID: 36a8f2c9d7e1
Revises: 7c1e5d2b9f30
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "36a8f2c9d7e1"
down_revision: str | Sequence[str] | None = "7c1e5d2b9f30"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    def company() -> sa.Column:
        return sa.Column("company_id", sa.String(36), sa.ForeignKey("biz_companies.id", ondelete="CASCADE"),
                         nullable=False)

    def application(*, primary: bool = False) -> sa.Column:
        return sa.Column("application_id", sa.String(36), sa.ForeignKey("biz_applications.id", ondelete="CASCADE"),
                         nullable=False, primary_key=primary)

    def stamp(name: str, nullable: bool = False) -> sa.Column:
        return sa.Column(name, sa.DateTime(timezone=True), nullable=nullable)

    op.create_table("biz_hiring_plans",
        sa.Column("job_id", sa.String(36), sa.ForeignKey("biz_jobs.id", ondelete="CASCADE"), primary_key=True),
        company(), sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("content", sa.JSON(), nullable=False), sa.Column("updated_by", sa.String(36)), stamp("updated_at"))
    op.create_index("ix_biz_hiring_plans_company_id", "biz_hiring_plans", ["company_id"])
    op.create_table("biz_interview_feedback",
        sa.Column("id", sa.String(36), primary_key=True), company(), application(),
        sa.Column("stage_id", sa.String(16), nullable=False), sa.Column("author_id", sa.String(36), nullable=False),
        sa.Column("author_name", sa.String(200), nullable=False), sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("plan_revision", sa.Integer(), nullable=False), sa.Column("plan_snapshot", sa.JSON(), nullable=False),
        sa.Column("content", sa.JSON(), nullable=False), stamp("submitted_at", True),
        stamp("created_at"), stamp("updated_at"),
        sa.UniqueConstraint("application_id", "stage_id", "author_id", name="uq_biz_feedback_author_stage"))
    op.create_index("ix_biz_interview_feedback_company_id", "biz_interview_feedback", ["company_id"])
    op.create_index("ix_biz_interview_feedback_application_id", "biz_interview_feedback", ["application_id"])
    op.create_table("biz_work_samples", application(primary=True), company(),
        sa.Column("plan_revision", sa.Integer(), nullable=False), sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("brief", sa.JSON(), nullable=False), sa.Column("answer", sa.JSON()),
        sa.Column("follow_up", sa.JSON()), stamp("submitted_at", True), stamp("completed_at", True),
        stamp("created_at"))
    op.create_index("ix_biz_work_samples_company_id", "biz_work_samples", ["company_id"])
    with op.batch_alter_table("biz_interviews") as batch:
        batch.add_column(sa.Column("panel_user_ids", sa.JSON()))
        batch.add_column(sa.Column("revision", sa.Integer(), nullable=False, server_default="0"))


def downgrade() -> None:
    with op.batch_alter_table("biz_interviews") as batch:
        batch.drop_column("revision")
        batch.drop_column("panel_user_ids")
    op.drop_table("biz_work_samples")
    op.drop_table("biz_interview_feedback")
    op.drop_table("biz_hiring_plans")
