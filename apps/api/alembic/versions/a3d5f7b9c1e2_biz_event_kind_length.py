"""Room for longer business event kinds: "interview_change_requested" (26) didn't fit biz_events.kind (24), so on
Postgres every candidate's reschedule request failed."""

import sqlalchemy as sa

from alembic import op

revision = "a3d5f7b9c1e2"
down_revision = "c9e3f5a7b2d4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("biz_events", schema=None) as batch_op:
        batch_op.alter_column("kind", existing_type=sa.String(24), type_=sa.String(48), existing_nullable=False)


def downgrade() -> None:
    # Fails while any kind longer than 24 is stored, rather than truncating it.
    with op.batch_alter_table("biz_events", schema=None) as batch_op:
        batch_op.alter_column("kind", existing_type=sa.String(48), type_=sa.String(24), existing_nullable=False)
