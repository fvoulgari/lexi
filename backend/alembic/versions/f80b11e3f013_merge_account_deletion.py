"""Join the account-deletion and collection migration histories."""

revision = "f80b11e3f013"
down_revision = ("e79a00d2f012", "c57e88a0e010")
branch_labels = None
depends_on = None


def upgrade():
    pass


def downgrade():
    raise RuntimeError("Restore a reviewed backup and reconcile subsequent writes.")
