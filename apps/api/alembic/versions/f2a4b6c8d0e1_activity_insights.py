"""Candidate insights: where an account came from, and what it did in the app."""
import sqlalchemy as sa

from alembic import op

revision = "f2a4b6c8d0e1"
down_revision = "e1f3a5c7b9d2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.add_column(sa.Column("signup_source", sa.JSON(), nullable=True))
    op.create_table("activity_events",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(12), nullable=False),
        sa.Column("name", sa.String(80), nullable=False),
        sa.Column("path", sa.String(200), nullable=False),
        sa.Column("device", sa.String(8), nullable=False),
        sa.Column("detail", sa.String(200), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False))
    op.create_index("ix_activity_events_user_created", "activity_events", ["user_id", "created_at"])
    op.create_index("ix_activity_events_created", "activity_events", ["created_at"])


def downgrade() -> None:
    op.drop_table("activity_events")
    with op.batch_alter_table("users") as batch:
        batch.drop_column("signup_source")
