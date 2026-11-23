"""Registry-backed language and direction integrity without rewriting content."""

import sqlalchemy as sa

from alembic import op
from app.languages import DIRECTION_PAIRS, LANGUAGE_LABELS, LANGUAGES

revision = "c1e0d5f7a901"
down_revision = "b7c41d0e9a32"
branch_labels = None
depends_on = None

LANGUAGE_VALUES = ", ".join(repr(language) for language in LANGUAGES)
DIRECTION_VALUES = ", ".join(repr(direction) for direction in DIRECTION_PAIRS)


def _legacy_language_checks():
    return {
        "vocabulary_card_languages": (
            f"source_language IN ({LANGUAGE_VALUES}) AND "
            f"target_language IN ({LANGUAGE_VALUES}) AND "
            "source_language <> target_language"
        ),
        "collection_pair": (
            f"source_language IN ({LANGUAGE_VALUES}) AND "
            f"target_language IN ({LANGUAGE_VALUES}) AND "
            "source_language < target_language"
        ),
    }


def _constraint_table(name):
    return (
        "vocabulary_entries" if name == "vocabulary_card_languages" else "collections"
    )


def _check_existing_rows():
    if op.get_context().as_sql:
        return
    db = op.get_bind()
    problems = []
    checks = (
        (
            "card source language",
            "SELECT id::text, source_language FROM vocabulary_entries "
            f"WHERE source_language NOT IN ({LANGUAGE_VALUES})",
        ),
        (
            "card target language",
            "SELECT id::text, target_language FROM vocabulary_entries "
            f"WHERE target_language NOT IN ({LANGUAGE_VALUES})",
        ),
        (
            "collection source language",
            "SELECT id::text, source_language FROM collections "
            f"WHERE source_language NOT IN ({LANGUAGE_VALUES})",
        ),
        (
            "collection target language",
            "SELECT id::text, target_language FROM collections "
            f"WHERE target_language NOT IN ({LANGUAGE_VALUES})",
        ),
        (
            "review direction",
            "SELECT id::text, direction FROM review_events "
            f"WHERE direction NOT IN ({DIRECTION_VALUES})",
        ),
        (
            "progress direction",
            "SELECT profile_id::text, direction FROM learning_progress "
            f"WHERE direction NOT IN ({DIRECTION_VALUES})",
        ),
        (
            "session direction",
            "SELECT id::text, direction FROM practice_sessions "
            f"WHERE direction NOT IN ({DIRECTION_VALUES})",
        ),
        (
            "revealed direction",
            "SELECT session_id::text, revealed_direction FROM session_cards "
            "WHERE revealed_direction IS NOT NULL "
            f"AND revealed_direction NOT IN ({DIRECTION_VALUES})",
        ),
    )
    for label, query in checks:
        rows = db.execute(sa.text(query)).all()
        if rows:
            samples = ", ".join(
                f"{identifier}={value}" for identifier, value in rows[:5]
            )
            problems.append(f"{label}: {samples}")
    if problems:
        raise RuntimeError(
            "Classify unsupported language registry values before migration: "
            + "; ".join(problems)
        )


def _create_registry_tables():
    op.create_table(
        "languages",
        sa.Column("id", sa.String(16), primary_key=True),
        sa.Column("display_name", sa.String(80), nullable=False),
        sa.CheckConstraint("id <> ''", name="language_id_not_blank"),
    )
    op.create_table(
        "practice_directions",
        sa.Column("name", sa.String(24), primary_key=True),
        sa.Column(
            "prompt_language",
            sa.String(16),
            sa.ForeignKey("languages.id", name="fk_direction_prompt_language"),
            nullable=False,
        ),
        sa.Column(
            "answer_language",
            sa.String(16),
            sa.ForeignKey("languages.id", name="fk_direction_answer_language"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "prompt_language <> answer_language", name="direction_languages_differ"
        ),
    )
    db = op.get_bind()
    for language in LANGUAGES:
        db.execute(
            sa.text(
                "INSERT INTO languages (id, display_name) "
                "VALUES (:id, :name) ON CONFLICT (id) DO NOTHING"
            ),
            {"id": language, "name": LANGUAGE_LABELS[language]},
        )
    for name, (prompt, answer) in DIRECTION_PAIRS.items():
        db.execute(
            sa.text(
                "INSERT INTO practice_directions "
                "(name, prompt_language, answer_language) "
                "VALUES (:name, :prompt, :answer) ON CONFLICT (name) DO NOTHING"
            ),
            {"name": name, "prompt": prompt, "answer": answer},
        )


def _grant_registry_read():
    op.execute(
        """
        DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lexi_app') THEN
                GRANT SELECT ON languages, practice_directions TO lexi_app;
            END IF;
        END $$
        """
    )


def _add_foreign_keys():
    for name, table, columns in (
        ("fk_vocabulary_source_language", "vocabulary_entries", ["source_language"]),
        ("fk_vocabulary_target_language", "vocabulary_entries", ["target_language"]),
        ("fk_collection_source_language", "collections", ["source_language"]),
        ("fk_collection_target_language", "collections", ["target_language"]),
    ):
        op.create_foreign_key(name, table, "languages", columns, ["id"])
    for name, table, column in (
        ("fk_review_direction", "review_events", "direction"),
        ("fk_progress_direction", "learning_progress", "direction"),
        ("fk_session_direction", "practice_sessions", "direction"),
        (
            "fk_session_card_revealed_direction",
            "session_cards",
            "revealed_direction",
        ),
    ):
        op.create_foreign_key(
            name, table, "practice_directions", [column], ["name"]
        )


def _drop_foreign_keys():
    for name, table in (
        ("fk_vocabulary_source_language", "vocabulary_entries"),
        ("fk_vocabulary_target_language", "vocabulary_entries"),
        ("fk_collection_source_language", "collections"),
        ("fk_collection_target_language", "collections"),
        ("fk_review_direction", "review_events"),
        ("fk_progress_direction", "learning_progress"),
        ("fk_session_direction", "practice_sessions"),
        ("fk_session_card_revealed_direction", "session_cards"),
    ):
        op.drop_constraint(name, table, type_="foreignkey")


def upgrade():
    _check_existing_rows()
    _create_registry_tables()
    _grant_registry_read()

    for name in _legacy_language_checks():
        op.drop_constraint(name, _constraint_table(name), type_="check")
    op.create_check_constraint(
        "vocabulary_card_languages",
        "vocabulary_entries",
        "source_language <> target_language",
    )
    op.create_check_constraint(
        "collection_pair", "collections", "source_language < target_language"
    )
    op.drop_constraint("valid_review_direction", "review_events", type_="check")
    _add_foreign_keys()


def downgrade():
    if not op.get_context().as_sql:
        db = op.get_bind()
        unsupported = db.execute(
            sa.text(
                "SELECT id FROM languages WHERE id NOT IN (" + LANGUAGE_VALUES + ") "
                "UNION ALL SELECT name FROM practice_directions "
                "WHERE name NOT IN (" + DIRECTION_VALUES + ")"
            )
        ).scalars().all()
        if unsupported:
            raise RuntimeError(
                "Remove registry-only languages and directions before downgrade: "
                + ", ".join(map(str, unsupported))
            )

    _drop_foreign_keys()
    for name, expression in _legacy_language_checks().items():
        table = _constraint_table(name)
        op.drop_constraint(name, table, type_="check")
        op.create_check_constraint(name, table, expression)
    op.create_check_constraint(
        "valid_review_direction",
        "review_events",
        "direction IN (" + DIRECTION_VALUES + ")",
    )
    op.drop_table("practice_directions")
    op.drop_table("languages")
