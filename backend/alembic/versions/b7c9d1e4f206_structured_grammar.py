"""Add one structured grammar store for enhanced languages.

Legacy language-named columns are preserved and backfilled into the JSON
column; they stay as compatibility aliases for existing readers.
"""

import sqlalchemy as sa

from alembic import op

revision = "b7c9d1e4f206"
down_revision = "d2e3f4a5b6c7"
branch_labels = None
depends_on = None

FIELDS = {
    "it": {
        "gender": "italian_gender",
        "plural": "italian_plural",
        "example": "italian_example",
        "pronunciation": "pronunciation",
        "adjective_gender": "italian_adjective_gender",
        "forms": {
            "masculine_singular": "italian_masculine_singular",
            "feminine_singular": "italian_feminine_singular",
            "masculine_plural": "italian_masculine_plural",
            "feminine_plural": "italian_feminine_plural",
        },
    },
    "el": {
        "gender": "greek_gender",
        "plural": "greek_plural",
        "example": "greek_example",
        "pronunciation": "greek_pronunciation",
        "adjective_gender": "greek_adjective_gender",
        "forms": {
            "masculine_singular": "greek_masculine_singular",
            "feminine_singular": "greek_feminine_singular",
            "neuter_singular": "greek_neuter_singular",
            "masculine_plural": "greek_masculine_plural",
            "feminine_plural": "greek_feminine_plural",
            "neuter_plural": "greek_neuter_plural",
        },
    },
}


def _literal(value):
    return "'" + value.replace("'", "''") + "'"


def _object(pairs):
    return "jsonb_strip_nulls(jsonb_build_object(" + ", ".join(
        f"{_literal(key)}, {expression}" for key, expression in pairs
    ) + "))"


def _language(language, definition):
    forms = _object(
        (name, f"NULLIF({column}, '')")
        for name, column in definition["forms"].items()
    )
    pairs = [
        ("gender", f"NULLIF(NULLIF({definition['gender']}, 'common'), '')"),
        *(
            (key, f"NULLIF({column}, '')")
            for key, column in definition.items()
            if key not in {"gender", "forms"}
        ),
        ("forms", f"NULLIF({forms}, '{{}}'::jsonb)"),
    ]
    return language, _object(pairs)


def upgrade():
    op.add_column("vocabulary_entries", sa.Column("grammar", sa.JSON(), nullable=True))
    cell = _object([_language(language, fields) for language, fields in FIELDS.items()])
    op.execute(
        "UPDATE vocabulary_entries SET grammar = "
        f"NULLIF({cell}, '{{}}'::jsonb)::json"
    )


def downgrade():
    op.drop_column("vocabulary_entries", "grammar")
