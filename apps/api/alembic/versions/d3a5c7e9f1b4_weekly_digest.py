"""Career playbook: opt-in weekly progress email, with a sign-in-free stop link."""
import sqlalchemy as sa

from alembic import op

revision = "d3a5c7e9f1b4"
down_revision = "c7e1a9d3b5f2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("career_playbooks") as batch:
        batch.add_column(sa.Column("weekly_digest", sa.Boolean(), nullable=False, server_default=sa.false()))
        batch.add_column(sa.Column("digest_sent_at", sa.DateTime(timezone=True), nullable=True))
        batch.add_column(sa.Column("digest_token", sa.String(64), nullable=True))
        batch.create_index("ix_career_playbooks_digest_token", ["digest_token"], unique=True)


def downgrade() -> None:
    with op.batch_alter_table("career_playbooks") as batch:
        batch.drop_index("ix_career_playbooks_digest_token")
        batch.drop_column("digest_token")
        batch.drop_column("digest_sent_at")
        batch.drop_column("weekly_digest")
