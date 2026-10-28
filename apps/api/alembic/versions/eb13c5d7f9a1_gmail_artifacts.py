"""Separate reviewed Gmail MIME bytes from frequently read attempt metadata."""
import base64

import sqlalchemy as sa

from alembic import op

revision = "eb13c5d7f9a1"
down_revision = "da02b4c6e8f0"
branch_labels = None
depends_on = None


def _tables() -> tuple[sa.Table, sa.Table]:
    metadata = sa.MetaData()
    attempts = sa.Table("gmail_attempts", metadata, sa.Column("id", sa.String(36), primary_key=True),
                        sa.Column("data", sa.JSON()))
    artifacts = sa.Table("gmail_artifacts", metadata, sa.Column("attempt_id", sa.String(36), primary_key=True),
                         sa.Column("content", sa.LargeBinary()))
    return attempts, artifacts


def upgrade() -> None:
    op.create_table("gmail_artifacts",
        sa.Column("attempt_id", sa.String(36), sa.ForeignKey("gmail_attempts.id", ondelete="CASCADE"),
                  primary_key=True),
        sa.Column("content", sa.LargeBinary(), nullable=False))
    attempts, artifacts = _tables()
    db = op.get_bind()
    after = ""
    while True:
        row = db.execute(sa.select(attempts).where(attempts.c.id > after).order_by(attempts.c.id).limit(1)).first()
        if row is None:
            break
        after = row.id
        data = dict(row.data)
        mime = data.pop("mime", None)
        if mime is not None:
            # Invalid legacy content fails the migration rather than silently losing a reviewed email.
            content = base64.b64decode(mime, validate=True)
            db.execute(artifacts.insert().values(attempt_id=row.id, content=content))
            db.execute(attempts.update().where(attempts.c.id == row.id).values(data=data))


def downgrade() -> None:
    attempts, artifacts = _tables()
    db = op.get_bind()
    after = ""
    while True:
        row = db.execute(sa.select(attempts, artifacts.c.content).join(
            artifacts, attempts.c.id == artifacts.c.attempt_id).where(attempts.c.id > after)
            .order_by(attempts.c.id).limit(1)).first()
        if row is None:
            break
        after = row.id
        db.execute(attempts.update().where(attempts.c.id == row.id).values(
            data={**row.data, "mime": base64.b64encode(row.content).decode("ascii")}))
    op.drop_table("gmail_artifacts")
