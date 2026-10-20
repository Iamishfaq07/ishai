"""Preserve preparation completion context across reschedules; legacy checkmarks remain untouched."""
import sqlalchemy as sa

from alembic import op

revision = "d51e7c9a240b"
down_revision = "c407e21a6d93"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("job_plan_checks", sa.Column("task_data", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("job_plan_checks", "task_data")
