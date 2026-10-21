"""Career playbook: opt-in tailored resume for each job saved from the feed."""
import sqlalchemy as sa

from alembic import op

revision = "e5b7d9f1a3c6"
down_revision = "d3a5c7e9f1b4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("career_playbooks") as batch:
        batch.add_column(sa.Column("auto_tailor", sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade() -> None:
    with op.batch_alter_table("career_playbooks") as batch:
        batch.drop_column("auto_tailor")
