"""Remove retired claim, recovery-request and shared-gate history.

Learning records and the active cross-account recovery guard are retained.
"""

from alembic import op

revision = "e25a17d8e017"
down_revision = "d14f06c7d016"
branch_labels = None
depends_on = None


def upgrade():
    # No CASCADE: unexpected references must block the migration.
    op.drop_table("legacy_claim_links")
    op.drop_table("legacy_progress_requests")
    op.drop_table("gate_sessions")
    op.execute("DROP FUNCTION anonymize_deleted_recovery_request()")


def downgrade():
    raise RuntimeError("Restore the reviewed backup to recover retired history.")
