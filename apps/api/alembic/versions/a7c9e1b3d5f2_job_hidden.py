"""Discover's "Not interested": jobs and companies a candidate hid from their feed."""

import sqlalchemy as sa

from alembic import op

revision = "a7c9e1b3d5f2"
down_revision = "cd71e3a4b820"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "job_hidden",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(8), nullable=False),
        sa.Column("value", sa.String(300), nullable=False),
        sa.Column("label", sa.String(300), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("user_id", "kind", "value", name="uq_job_hidden"),
    )
    op.create_index("ix_job_hidden_user_id", "job_hidden", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_job_hidden_user_id", table_name="job_hidden")
    op.drop_table("job_hidden")
