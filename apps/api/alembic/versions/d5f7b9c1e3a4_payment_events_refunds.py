"""Payments that settle and refund on the record (V3-07, V3-08, V3-09): a row per webhook event and per refund, the
amount refunded on each payment, and the reconciler's bookkeeping for orders still open.

Refunds noted before this (audit rows "payment.refunded": "<payment> <rfnd_…> ₹<rupees> credits kept") become
refund rows linked to their payment, and the payment's refunded amount is set from them.

Revision ID: d5f7b9c1e3a4
Revises: c3e5a7b9d1f2
Create Date: 2026-10-14 20:30:00.000000

"""
import re
import uuid
from collections.abc import Sequence
from datetime import UTC, datetime

import sqlalchemy as sa

from alembic import op

revision: str = "d5f7b9c1e3a4"
down_revision: str | Sequence[str] | None = "c3e5a7b9d1f2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_NOTED = re.compile(r"^(\S+) (rfnd_\w+) ₹(\d+)")


def upgrade() -> None:
    with op.batch_alter_table("payments", schema=None) as batch_op:
        batch_op.add_column(sa.Column("refunded_paise", sa.Integer(), nullable=False, server_default="0"))
        batch_op.add_column(sa.Column("reconcile_attempts", sa.Integer(), nullable=False, server_default="0"))
        batch_op.add_column(sa.Column("checked_at", sa.DateTime(timezone=True), nullable=True))
    op.create_table(
        "payment_refunds",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("refund_id", sa.String(length=40), nullable=False, unique=True),
        sa.Column("gateway_payment_id", sa.String(length=40), nullable=False),
        sa.Column("payment_id", sa.String(length=36), sa.ForeignKey("payments.id", ondelete="SET NULL"),
                  nullable=True),
        sa.Column("amount_paise", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("linked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_payment_refunds_gateway_payment_id", "payment_refunds", ["gateway_payment_id"])
    op.create_index("ix_payment_refunds_payment_id", "payment_refunds", ["payment_id"])
    op.create_table(
        "payment_events",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("provider", sa.String(length=16), nullable=False),
        sa.Column("event_id", sa.String(length=80), nullable=False, unique=True),
        sa.Column("event", sa.String(length=40), nullable=False),
        sa.Column("entity_id", sa.String(length=40), nullable=True),
        sa.Column("status", sa.String(length=12), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("error", sa.String(length=300), nullable=True),
        sa.Column("data", sa.JSON(none_as_null=True), nullable=True),
        sa.Column("processed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_payment_events_status_created", "payment_events", ["status", "created_at"])

    conn = op.get_bind()
    noted = conn.execute(sa.text(
        "SELECT target, created_at FROM audit_logs WHERE action = 'payment.refunded' ORDER BY created_at")).all()
    seen: set[str] = set()
    for target, at in noted:
        m = _NOTED.match(target or "")
        if not m or m.group(2) in seen:
            continue
        payment_id, refund_id, rupees = m.group(1), m.group(2), int(m.group(3))
        pay = conn.execute(sa.text("SELECT gateway_payment_id FROM payments WHERE id = :id"),
                           {"id": payment_id}).first()
        if pay is None or not pay[0]:
            continue
        seen.add(refund_id)
        conn.execute(sa.text(
            "INSERT INTO payment_refunds (id, refund_id, gateway_payment_id, payment_id, amount_paise, status, "
            "linked_at, created_at) VALUES (:id, :refund, :gpay, :pid, :amount, 'processed', :at, :at)"),
            {"id": str(uuid.uuid4()), "refund": refund_id, "gpay": pay[0], "pid": payment_id,
             "amount": rupees * 100, "at": at or datetime.now(UTC)})
    conn.execute(sa.text(
        "UPDATE payments SET refunded_paise = (SELECT COALESCE(SUM(r.amount_paise), 0) FROM payment_refunds r "
        "WHERE r.payment_id = payments.id AND r.status = 'processed')"))


def downgrade() -> None:
    op.drop_index("ix_payment_events_status_created", table_name="payment_events")
    op.drop_table("payment_events")
    op.drop_index("ix_payment_refunds_payment_id", table_name="payment_refunds")
    op.drop_index("ix_payment_refunds_gateway_payment_id", table_name="payment_refunds")
    op.drop_table("payment_refunds")
    with op.batch_alter_table("payments", schema=None) as batch_op:
        batch_op.drop_column("checked_at")
        batch_op.drop_column("reconcile_attempts")
        batch_op.drop_column("refunded_paise")
