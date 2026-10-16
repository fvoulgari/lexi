"""Require vocabulary units and snapshot legacy profiles' practice access."""

from uuid import uuid4

import sqlalchemy as sa

from alembic import op

revision = "e13f44d6a005"
down_revision = "d02f33c5f004"
branch_labels = None
depends_on = None


def upgrade():
    connection = op.get_bind()
    if connection.scalar(
        sa.text("SELECT count(*) FROM vocabulary_entries WHERE unit_id IS NULL")
    ):
        fallback_id = uuid4()
        # Do not reuse a user-defined code, even if it resembles our fallback.
        connection.execute(
            sa.text(
                "INSERT INTO units (id, code, title, sort_order) "
                "VALUES (:id, :code, :title, 0)"
            ),
            {
                "id": fallback_id,
                "code": "legacy-" + uuid4().hex[:12],
                "title": "Χωρίς ταξινόμηση",
            },
        )
        connection.execute(
            sa.text(
                "UPDATE vocabulary_entries SET unit_id = :id WHERE unit_id IS NULL"
            ),
            {"id": fallback_id},
        )
    inspector = sa.inspect(connection)
    for fk in inspector.get_foreign_keys("vocabulary_entries"):
        if fk["constrained_columns"] == ["unit_id"]:
            op.drop_constraint(fk["name"], "vocabulary_entries", type_="foreignkey")
    op.alter_column("vocabulary_entries", "unit_id", nullable=False)
    op.create_foreign_key(
        "fk_vocabulary_unit_required",
        "vocabulary_entries",
        "units",
        ["unit_id"],
        ["id"],
        ondelete="RESTRICT",
    )
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
    # Exactly once: [] after this migration always means an intentional empty pool.
    connection.execute(
        sa.text(
            "INSERT INTO profile_practice_units (profile_id, unit_id) "
            "SELECT profiles.id, units.id FROM profiles CROSS JOIN units"
        )
    )


def downgrade():
    op.drop_table("profile_practice_units")
    op.drop_constraint(
        "fk_vocabulary_unit_required", "vocabulary_entries", type_="foreignkey"
    )
    op.alter_column("vocabulary_entries", "unit_id", nullable=True)
    op.create_foreign_key(
        "vocabulary_entries_unit_id_fkey",
        "vocabulary_entries",
        "units",
        ["unit_id"],
        ["id"],
        ondelete="SET NULL",
    )
    # Retain the fallback unit and its assignments to avoid destructive rollback.
