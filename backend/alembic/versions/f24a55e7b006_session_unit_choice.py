"""Choose practice units per session instead of assigning units to profiles."""

import sqlalchemy as sa

from alembic import op

revision = "f24a55e7b006"
down_revision = "e13f44d6a005"
branch_labels = None
depends_on = None


def upgrade():
    # Only obsolete preferences are removed; cards and learning history remain.
    op.drop_table("profile_practice_units")


def downgrade():
    op.create_table(
        "profile_practice_units",
        sa.Column(
            "profile_id",
            sa.Uuid(),
            sa.ForeignKey("profiles.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "unit_id",
            sa.Uuid(),
            sa.ForeignKey("units.id", ondelete="RESTRICT"),
            primary_key=True,
        ),
    )
    op.create_index(
        "ix_profile_practice_units_unit_id", "profile_practice_units", ["unit_id"]
    )
