"""Keep immutable snapshot source observations; no historical inference/backfill."""
import sqlalchemy as sa

from alembic import op

revision = "a84b0f2d573e"
down_revision = "f73a9e1c462d"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("resume_snapshots", sa.Column("origin", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("resume_snapshots", "origin")
