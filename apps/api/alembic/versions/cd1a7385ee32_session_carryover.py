"""sessions.carryover: what a live session remembers, kept on the row so a restart mid-session continues it

A dropped connection's state (recent turns, questions, the last answer, a mock round's place and clock:
live/carryover.py) was kept in process memory only, so a server restart (every deploy) mid-session lost it: a mock
interview started over at question 1, a live one lost the thread. It's now also saved on the session row, every
heartbeat and when the connection drops, and cleared when the session ends. Existing rows start without it.

Revision ID: cd1a7385ee32
Revises: 45a95e374d53
Create Date: 2026-10-05 21:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'cd1a7385ee32'
down_revision: str | Sequence[str] | None = '45a95e374d53'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table('sessions', schema=None) as batch_op:
        batch_op.add_column(sa.Column('carryover', sa.JSON(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('sessions', schema=None) as batch_op:
        batch_op.drop_column('carryover')
