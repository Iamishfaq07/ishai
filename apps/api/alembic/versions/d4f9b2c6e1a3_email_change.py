"""email_tokens.new_email: verified email change

Revision ID: d4f9b2c6e1a3
Revises: c3e8a1d5f7b2
"""

import sqlalchemy as sa

from alembic import op

revision = "d4f9b2c6e1a3"
down_revision = "c3e8a1d5f7b2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("email_tokens", sa.Column("new_email", sa.String(320), nullable=True))


def downgrade() -> None:
    op.drop_column("email_tokens", "new_email")
