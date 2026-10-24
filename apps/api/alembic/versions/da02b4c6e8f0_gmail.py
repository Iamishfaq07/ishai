"""Gmail encrypted connections and durable send attempts."""
import sqlalchemy as sa

from alembic import op

revision = "da02b4c6e8f0"
down_revision = "c9f1a3b5d7e9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table("gmail_connections",
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("data", sa.JSON(), nullable=False))
    op.create_table("gmail_attempts",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("application_id", sa.String(36), sa.ForeignKey("job_applications.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("status", sa.String(16), nullable=False), sa.Column("data", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("user_id", "application_id", name="uq_gmail_application"))
    op.create_index("ix_gmail_attempts_user_id", "gmail_attempts", ["user_id"])


def downgrade() -> None:
    op.drop_table("gmail_attempts")
    op.drop_table("gmail_connections")
