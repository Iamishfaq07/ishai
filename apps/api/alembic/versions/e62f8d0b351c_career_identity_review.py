"""Explicit master selection and version-bound candidate review; no automatic approval/backfill."""
import sqlalchemy as sa

from alembic import op

revision = "e62f8d0b351c"
down_revision = "d51e7c9a240b"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("job_search_profiles", sa.Column("career_identity", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("job_search_profiles", "career_identity")
