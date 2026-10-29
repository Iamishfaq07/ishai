"""Ask a mentor: a mock interview report shared by link, and the mentor's comments."""

import sqlalchemy as sa

from alembic import op

revision = "c3e5a7b9d1f4"
down_revision = "b8d2f4a6c1e3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "mentor_shares",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("session_id", sa.String(36), sa.ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("label", sa.String(80), nullable=False),
        sa.Column("snapshot", sa.JSON(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("views", sa.Integer(), nullable=False),
        sa.Column("last_viewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_mentor_shares_user_id", "mentor_shares", ["user_id"])
    op.create_index("ix_mentor_shares_session_id", "mentor_shares", ["session_id"])
    op.create_table(
        "mentor_comments",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("share_id", sa.String(36), sa.ForeignKey("mentor_shares.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("item", sa.Integer(), nullable=True),
        sa.Column("author", sa.String(80), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_mentor_comments_share_id", "mentor_comments", ["share_id"])
    op.create_index("ix_mentor_comments_user_id", "mentor_comments", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_mentor_comments_user_id", table_name="mentor_comments")
    op.drop_index("ix_mentor_comments_share_id", table_name="mentor_comments")
    op.drop_table("mentor_comments")
    op.drop_index("ix_mentor_shares_session_id", table_name="mentor_shares")
    op.drop_index("ix_mentor_shares_user_id", table_name="mentor_shares")
    op.drop_table("mentor_shares")
