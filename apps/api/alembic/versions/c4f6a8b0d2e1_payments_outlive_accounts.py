"""payments outlive their account; one credit grant per payment; welcome grants remember the inbox

A deleted account used to take its payments with it, and with them the UTR's unique row, so the same bank transfer
could be submitted again from a new account. Payments now keep their row (user_id set to NULL). Approving a payment
twice at once could also add its credits twice: credit_entries gets one row per (payment, kind) at most.

Revision ID: c4f6a8b0d2e1
Revises: a9d3f5b7c2e4
Create Date: 2026-10-03 04:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'c4f6a8b0d2e1'
down_revision: str | Sequence[str] | None = 'a9d3f5b7c2e4'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

ONE_GRANT = "uq_credit_entries_payment_kind"


def upgrade() -> None:
    """Upgrade schema."""
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.alter_column("payments", "user_id", existing_type=sa.String(length=36), nullable=True)
        # Created unnamed in e7b3c9d1f5a2 (Postgres calls it payments_user_id_fkey): look it up rather than assume.
        for fk in sa.inspect(bind).get_foreign_keys("payments"):
            if fk["constrained_columns"] == ["user_id"] and fk.get("name"):
                op.drop_constraint(fk["name"], "payments", type_="foreignkey")
        op.create_foreign_key("payments_user_id_fkey", "payments", "users", ["user_id"], ["id"],
                              ondelete="SET NULL")
    else:  # SQLite (development): the table is rebuilt; the reflected (unnamed) FK gets a name so it can be swapped
        naming = {"fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s"}
        with op.batch_alter_table("payments", recreate="always", naming_convention=naming) as batch_op:
            batch_op.alter_column("user_id", existing_type=sa.String(length=36), nullable=True)
            batch_op.drop_constraint("fk_payments_user_id_users", type_="foreignkey")
            batch_op.create_foreign_key("fk_payments_user_id_users", "users", ["user_id"], ["id"],
                                        ondelete="SET NULL")
    # The welcome grant's inbox (credits.inbox), so one mailbox gets one welcome however it's spelled.
    op.add_column("credit_entries", sa.Column("email_hash", sa.String(length=64), nullable=True))
    op.create_index("ix_credit_entries_email_hash", "credit_entries", ["email_hash"])
    # A payment approved twice before this fix left two grants: keep the index off rather than fail the deploy
    # (the approval itself is now a conditional update, so it can't happen again).
    dupes = bind.execute(sa.text(
        "SELECT COUNT(*) FROM (SELECT payment_id, kind FROM credit_entries WHERE payment_id IS NOT NULL "
        "GROUP BY payment_id, kind HAVING COUNT(*) > 1) d")).scalar()
    if not dupes:
        op.create_index(ONE_GRANT, "credit_entries", ["payment_id", "kind"], unique=True,
                        postgresql_where=sa.text("payment_id IS NOT NULL"),
                        sqlite_where=sa.text("payment_id IS NOT NULL"))
    else:
        print(f"WARNING: {dupes} payment(s) were credited twice; {ONE_GRANT} not created. Review credit_entries.")


def downgrade() -> None:
    """Downgrade schema."""
    bind = op.get_bind()
    op.execute(f"DROP INDEX IF EXISTS {ONE_GRANT}")
    op.drop_index("ix_credit_entries_email_hash", table_name="credit_entries")
    with op.batch_alter_table("credit_entries") as batch_op:
        batch_op.drop_column("email_hash")
    if bind.dialect.name == "postgresql":
        op.drop_constraint("payments_user_id_fkey", "payments", type_="foreignkey")
        op.create_foreign_key("payments_user_id_fkey", "payments", "users", ["user_id"], ["id"], ondelete="CASCADE")
        op.execute("DELETE FROM payments WHERE user_id IS NULL")
        op.alter_column("payments", "user_id", existing_type=sa.String(length=36), nullable=False)
