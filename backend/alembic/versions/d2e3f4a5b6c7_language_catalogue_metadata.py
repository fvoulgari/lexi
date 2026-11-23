"""Add curation, script and direction metadata to the language registry."""

import sqlalchemy as sa

from alembic import op

revision = "d2e3f4a5b6c7"
down_revision = "c1e0d5f7a901"
branch_labels = None
depends_on = None

CURATED_LANGUAGES = {
    "da": ("Latn", "ltr", False),
    "el": ("Grek", "ltr", True),
    "en": ("Latn", "ltr", False),
    "it": ("Latn", "ltr", True),
}
LEGACY_DIRECTIONS = ("greek_to_italian", "italian_to_greek")


def upgrade():
    op.add_column(
        "languages",
        sa.Column(
            "publicly_available",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
    )
    op.add_column(
        "languages",
        sa.Column(
            "script",
            sa.String(16),
            server_default="Latn",
            nullable=False,
        ),
    )
    op.add_column(
        "languages",
        sa.Column(
            "text_direction",
            sa.String(3),
            server_default="ltr",
            nullable=False,
        ),
    )
    op.add_column(
        "languages",
        sa.Column(
            "enhanced",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
    )
    op.create_check_constraint(
        "valid_language_text_direction",
        "languages",
        "text_direction IN ('ltr', 'rtl')",
    )
    op.create_check_constraint(
        "language_script_not_blank", "languages", "script <> ''"
    )
    op.add_column(
        "practice_directions",
        sa.Column(
            "legacy",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
    )
    db = op.get_bind()
    for code, (script, text_direction, enhanced) in CURATED_LANGUAGES.items():
        db.execute(
            sa.text(
                "UPDATE languages SET publicly_available = true, script = :script, "
                "text_direction = :text_direction, enhanced = :enhanced "
                "WHERE id = :id"
            ),
            {
                "id": code,
                "script": script,
                "text_direction": text_direction,
                "enhanced": enhanced,
            },
        )
    for key in LEGACY_DIRECTIONS:
        db.execute(
            sa.text(
                "UPDATE practice_directions SET legacy = true WHERE name = :name"
            ),
            {"name": key},
        )


def downgrade():
    op.drop_column("practice_directions", "legacy")
    op.drop_constraint("valid_language_text_direction", "languages", type_="check")
    op.drop_constraint("language_script_not_blank", "languages", type_="check")
    for column in ("enhanced", "text_direction", "script", "publicly_available"):
        op.drop_column("languages", column)
