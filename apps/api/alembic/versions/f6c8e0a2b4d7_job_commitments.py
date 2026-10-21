"""Job commitments: what the candidate promised an employer, as dated to-dos on Today."""
import sqlalchemy as sa

from alembic import op

revision = "f6c8e0a2b4d7"
down_revision = "e5b7d9f1a3c6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "job_commitments",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("application_id", sa.String(36), sa.ForeignKey("job_applications.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("text", sa.String(300), nullable=False),
        sa.Column("due_at", sa.DateTime(timezone=True)),
        sa.Column("done_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_job_commitments_user_id", "job_commitments", ["user_id"])
    op.create_index("ix_job_commitments_application_id", "job_commitments", ["application_id"])


def downgrade() -> None:
    op.drop_index("ix_job_commitments_application_id", "job_commitments")
    op.drop_index("ix_job_commitments_user_id", "job_commitments")
    op.drop_table("job_commitments")
