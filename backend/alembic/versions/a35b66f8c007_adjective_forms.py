"""Add optional manually entered Italian adjective forms; preserve legacy data."""

import sqlalchemy as sa

from alembic import op

revision = "a35b66f8c007"
down_revision = "f24a55e7b006"
branch_labels = None
depends_on = None


def upgrade():
    for field in (
        "italian_feminine_singular",
        "italian_masculine_plural",
        "italian_feminine_plural",
    ):
        op.add_column(
            "vocabulary_entries", sa.Column(field, sa.String(500), nullable=True)
        )


def downgrade():
    for field in (
        "italian_feminine_plural",
        "italian_masculine_plural",
        "italian_feminine_singular",
    ):
        op.drop_column("vocabulary_entries", field)
