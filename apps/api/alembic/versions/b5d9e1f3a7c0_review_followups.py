"""Optional review follow-ups and explicit reviewer handoff provenance."""

import sqlalchemy as sa

from alembic import op

revision = "b5d9e1f3a7c0"
down_revision = "a4c8d0e2f6b9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("biz_workflow_reviews") as batch:
        batch.add_column(sa.Column("due_date", sa.String(10)))
        batch.add_column(sa.Column("reminders_enabled", sa.Boolean(), nullable=False, server_default=sa.false()))
        batch.add_column(sa.Column("snoozed_until", sa.DateTime(timezone=True)))
        batch.add_column(sa.Column("reminder_count", sa.Integer(), nullable=False, server_default="0"))
        batch.add_column(sa.Column("last_reminded_at", sa.DateTime(timezone=True)))
        batch.add_column(sa.Column("previous_review_id", sa.String(36)))
        batch.add_column(sa.Column("handoff_note", sa.String(600), nullable=False, server_default=""))
    op.create_index(
        "ix_biz_workflow_reviews_followup",
        "biz_workflow_reviews",
        ["reminders_enabled", "status", "due_date", "company_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_biz_workflow_reviews_followup", table_name="biz_workflow_reviews")
    with op.batch_alter_table("biz_workflow_reviews") as batch:
        for column in (
            "handoff_note",
            "previous_review_id",
            "last_reminded_at",
            "reminder_count",
            "snoozed_until",
            "reminders_enabled",
            "due_date",
        ):
            batch.drop_column(column)
