"""Join the independently merged playbook and form-agent migrations.

No DDL: each parent keeps its original identity so already applied databases can converge safely.
"""

revision = "c407e21a6d93"
down_revision = ("82ac6d705f91", "91bd47e8c2a0")
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
