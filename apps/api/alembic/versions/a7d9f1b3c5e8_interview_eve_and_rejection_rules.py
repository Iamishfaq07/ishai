"""Workflow rules: a note after a rejection, and the interview-eve email (both off until the candidate enables them)."""
import sqlalchemy as sa

from alembic import op

revision = "a7d9f1b3c5e8"
down_revision = "f6c8e0a2b4d7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("career_playbooks") as batch:
        batch.add_column(sa.Column("rejection_days", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("interview_eve_email", sa.Boolean(), nullable=False, server_default=sa.false()))
    with op.batch_alter_table("job_applications") as batch:
        batch.add_column(sa.Column("eve_reminded_for", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("job_applications") as batch:
        batch.drop_column("eve_reminded_for")
    with op.batch_alter_table("career_playbooks") as batch:
        batch.drop_column("interview_eve_email")
        batch.drop_column("rejection_days")
