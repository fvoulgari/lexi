"""Persist learner default session size."""

import sqlalchemy as sa

from alembic import op

revision = "b80d11a3e002"
down_revision = "30775cbfd419"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "profiles",
        sa.Column(
            "default_session_size",
            sa.Integer(),
            server_default="25",
            nullable=True,
        ),
    )


def downgrade():
    op.drop_column("profiles", "default_session_size")
