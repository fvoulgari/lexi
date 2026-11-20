"""Invalidate unfinished claim links without deleting claim history."""

import sqlalchemy as sa

from alembic import op

revision = "e79a00d2f012"
down_revision = "d68f99c1f011"
branch_labels = None
depends_on = None


def upgrade():
    db = op.get_bind()
    db.execute(sa.text("""
        UPDATE legacy_claim_links SET revoked_at = CURRENT_TIMESTAMP
        WHERE consumed_at IS NULL AND revoked_at IS NULL
    """))
    db.execute(sa.text("""
        UPDATE legacy_claim_continuations SET expires_at = CURRENT_TIMESTAMP
        WHERE expires_at > CURRENT_TIMESTAMP
    """))


def downgrade():
    raise RuntimeError("Restore a reviewed backup and reconcile subsequent writes.")
