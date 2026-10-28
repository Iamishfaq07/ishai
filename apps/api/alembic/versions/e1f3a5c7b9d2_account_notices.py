"""Account notices: credits, plans, approvals and rewards told in the app."""
import sqlalchemy as sa

from alembic import op

revision = "e1f3a5c7b9d2"
down_revision = "da02b4c6e8f0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table("account_notices",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(24), nullable=False),
        sa.Column("title", sa.String(160), nullable=False),
        sa.Column("body", sa.String(600), nullable=False),
        sa.Column("link", sa.String(300), nullable=True),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False))
    op.create_index("ix_account_notices_user_created", "account_notices", ["user_id", "created_at"])


def downgrade() -> None:
    op.drop_table("account_notices")
