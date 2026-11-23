"""Constrain card language IDs without rewriting stored text or history."""

import sqlalchemy as sa

from alembic import op
from app.languages import LANGUAGES

revision = "f7a12b4c0001"
down_revision = "b58d40a1b020"
branch_labels = None
depends_on = None


def upgrade():
    values = ", ".join(repr(language) for language in LANGUAGES)
    db = op.get_bind()
    # Only constrain tables whose existing cards already use supported, distinct
    # IDs. Unsupported rows are reported for classification; no text is rewritten.
    invalid = db.execute(
        sa.text(
            "SELECT id FROM vocabulary_entries "
            f"WHERE source_language NOT IN ({values}) "
            f"OR target_language NOT IN ({values}) "
            "OR source_language = target_language ORDER BY id"
        )
    ).scalars().all()
    if invalid:
        raise RuntimeError(
            "Classify unsupported card language IDs before migration: "
            + ", ".join(map(str, invalid))
        )
    op.create_check_constraint(
        "vocabulary_card_languages",
        "vocabulary_entries",
        f"source_language IN ({values}) AND "
        f"target_language IN ({values}) AND "
        "source_language <> target_language",
    )


def downgrade():
    op.drop_constraint("vocabulary_card_languages", "vocabulary_entries", type_="check")
