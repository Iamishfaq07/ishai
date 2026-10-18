"""orbit for business review fixes (D82 amendments): a random, sealed status token per application, the retention in
effect when each person applied, and the reminders before a requested deletion

Revision ID: 25f71d009e96
Revises: 4a93a7c927ef
Create Date: 2026-10-19 02:20:00.000000

Data-safe: three columns are added (two nullable or defaulted), and existing rows are filled in place:
- retention_months from the company's current setting (what the notice they agreed to said, or the closest record of
  it there is);
- status_token_sealed: an existing application's link token was derived from the JWT secret. It's sealed as it is, so
  every link already emailed keeps working and later emails carry the same one; new applications get a random token.
Downgrade drops the three columns (the stored token hashes are untouched, so old links still work after it).
"""
import base64
import hashlib
import hmac
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = '25f71d009e96'
down_revision: str | Sequence[str] | None = '4a93a7c927ef'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _legacy_token(jwt_secret: str, application_id: str) -> str:
    mac = hmac.new(jwt_secret.encode(), f"biz-status:{application_id}".encode(), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(mac).decode().rstrip("=")


def upgrade() -> None:
    with op.batch_alter_table('biz_applications') as batch:
        batch.add_column(sa.Column('status_token_sealed', sa.Text(), nullable=True))
        batch.add_column(sa.Column('retention_months', sa.Integer(), server_default='12', nullable=False))
        batch.add_column(sa.Column('deletion_reminders', sa.Integer(), server_default='0', nullable=False))

    bind = op.get_bind()
    bind.execute(sa.text(
        "UPDATE biz_applications SET retention_months = (SELECT c.retention_months FROM biz_companies c "
        "WHERE c.id = biz_applications.company_id)"))
    rows = bind.execute(sa.text("SELECT id, status_token_hash FROM biz_applications")).all()
    if not rows:
        return
    from cryptography.fernet import Fernet

    from orbit_api.config import get_settings

    s = get_settings()
    jwt_secret = s.jwt_secret.get_secret_value()
    source = s.config_secret.get_secret_value() if s.config_secret else "biz-status:" + jwt_secret
    sealer = Fernet(base64.urlsafe_b64encode(hashlib.sha256(source.encode()).digest()))
    for app_id, token_hash in rows:
        raw = _legacy_token(jwt_secret, app_id)
        if hashlib.sha256(raw.encode()).hexdigest() != token_hash:
            continue  # made under another secret: its link still works by its hash; later emails won't repeat it
        bind.execute(sa.text("UPDATE biz_applications SET status_token_sealed = :sealed WHERE id = :id"),
                     {"sealed": sealer.encrypt(raw.encode()).decode(), "id": app_id})


def downgrade() -> None:
    with op.batch_alter_table('biz_applications') as batch:
        batch.drop_column('deletion_reminders')
        batch.drop_column('retention_months')
        batch.drop_column('status_token_sealed')
