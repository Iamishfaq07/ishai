"""Durable enterprise hiring tasks and job automation recipes.

Revision ID: 58ca94f2d7e3
Revises: 47b9e3d0a6f2
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "58ca94f2d7e3"
down_revision: str | Sequence[str] | None = "47b9e3d0a6f2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table("biz_automations",
        sa.Column("job_id", sa.String(36), sa.ForeignKey("biz_jobs.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("company_id", sa.String(36), sa.ForeignKey("biz_companies.id", ondelete="CASCADE"), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False), sa.Column("content", sa.JSON(), nullable=False),
        sa.Column("last_run_at", sa.DateTime(timezone=True)),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False))
    op.create_index("ix_biz_automations_company_id", "biz_automations", ["company_id"])
    op.create_table("biz_hiring_tasks",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("company_id", sa.String(36), sa.ForeignKey("biz_companies.id", ondelete="CASCADE"), nullable=False),
        sa.Column("application_id", sa.String(36),
            sa.ForeignKey("biz_applications.id", ondelete="CASCADE"), nullable=False),
        sa.Column("job_id", sa.String(36), sa.ForeignKey("biz_jobs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("source_key", sa.String(64), nullable=False), sa.Column("kind", sa.String(24), nullable=False),
        sa.Column("title", sa.String(200), nullable=False), sa.Column("status", sa.String(12), nullable=False),
        sa.Column("assignee_id", sa.String(36)), sa.Column("due_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("snoozed_until", sa.DateTime(timezone=True)), sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("resolution", sa.String(120)), sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("application_id", "source_key", name="uq_biz_task_source"))
    for key in ("company_id", "application_id", "job_id"):
        op.create_index(f"ix_biz_hiring_tasks_{key}", "biz_hiring_tasks", [key])
    op.create_index("ix_biz_task_company_status_due", "biz_hiring_tasks", ["company_id", "status", "due_at"])


def downgrade() -> None:
    op.drop_table("biz_hiring_tasks")
    op.drop_table("biz_automations")
