"""Allow collection-owned cards without inventing a compatibility Unit."""

from alembic import op

revision = "b92d84a5b014"
down_revision = "f80b11e3f013"
branch_labels = None
depends_on = None


def upgrade():
    op.alter_column("vocabulary_entries", "unit_id", nullable=True)


def downgrade():
    raise RuntimeError(
        "Restore a reviewed backup and reconcile cards created without a Unit."
    )
