"""Retire two empty, unused claim-flow tables without discarding history."""

from sqlalchemy import text

from alembic import op

revision = "d14f06c7d016"
down_revision = "c03e95b6c015"
branch_labels = None
depends_on = None


def upgrade():
    db = op.get_bind()
    db.execute(
        text(
            "LOCK TABLE legacy_claim_continuations, legacy_resolution_cases "
            "IN ACCESS EXCLUSIVE MODE"
        )
    )
    for table in ("legacy_claim_continuations", "legacy_resolution_cases"):
        if db.scalar(text(f"SELECT EXISTS (SELECT 1 FROM {table})")):
            raise RuntimeError(f"{table} contains records; review before removal")
    op.drop_table("legacy_claim_continuations")
    op.drop_table("legacy_resolution_cases")


def downgrade():
    raise RuntimeError("Restore a reviewed backup to recover the old table structures.")
