"""Record account deletions until the authentication provider confirms removal."""

import sqlalchemy as sa

from alembic import op

revision = "c57e88a0e010"
down_revision = "b46d77a9d009"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "account_deletions",
        sa.Column("subject_hash", sa.String(64), primary_key=True),
        sa.Column("provider_subject", sa.String(255), nullable=True),
    )


def downgrade():
    raise RuntimeError("Account deletion records cannot be safely downgraded.")
