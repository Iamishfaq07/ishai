"""Career playbook: thank-you, quiet-application and saved-job rules (all off until the candidate enables them)."""
import sqlalchemy as sa

from alembic import op

revision = "c7e1a9d3b5f2"
down_revision = "a84b0f2d573e"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("career_playbooks") as batch:
        batch.add_column(sa.Column("thank_you_hours", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("stale_days", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("saved_days", sa.Integer(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("career_playbooks") as batch:
        batch.drop_column("saved_days")
        batch.drop_column("stale_days")
        batch.drop_column("thank_you_hours")
