"""Exercise the real migration on a separate legacy schema, including reviews."""

from pathlib import Path
from uuid import uuid4

import pytest
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.operations import Operations
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, text
from sqlalchemy.exc import IntegrityError


def test_legacy_cards_reviews_and_one_time_practice_access(test_database):
    engine = create_engine(test_database)
    schema = "migration_" + uuid4().hex
    config = Config(str(Path(__file__).parents[1] / "alembic.ini"))
    scripts = ScriptDirectory.from_config(config)
    profile, unit, card, session, review = [uuid4() for _ in range(5)]
    with engine.connect() as connection:
        try:
            connection.execute(text(f'CREATE SCHEMA "{schema}"'))
            connection.execute(text(f'SET search_path TO "{schema}"'))
            context = MigrationContext.configure(connection)
            with Operations.context(context):
                for revision in reversed(
                    list(scripts.walk_revisions(base="base", head="d02f33c5f004"))
                ):
                    revision.module.upgrade()
                connection.execute(
                    text(
                        "INSERT INTO profiles (id, display_name, "
                        "preferred_direction) VALUES (:id, 'Legacy', "
                        "'greek_to_italian')"
                    ),
                    {"id": profile},
                )
                connection.execute(
                    text(
                        "INSERT INTO units (id, code, title, sort_order) VALUES "
                        "(:id, '00', 'Original', 0)"
                    ),
                    {"id": unit},
                )
                connection.execute(
                    text(
                        "INSERT INTO vocabulary_entries (id, italian, greek, "
                        "word_type) VALUES (:id, 'casa', 'σπίτι', 'noun')"
                    ),
                    {"id": card},
                )
                connection.execute(
                    text(
                        "INSERT INTO practice_sessions (id, profile_id, direction, "
                        "requested_size, available) VALUES (:id, :profile, "
                        "'greek_to_italian', 10, 1)"
                    ),
                    {"id": session, "profile": profile},
                )
                connection.execute(
                    text(
                        "INSERT INTO session_cards (session_id, position, entry_id,"
                        " snapshot) VALUES (:session, 0, :card, "
                        '\'{"italian":"casa","unit": null}\')'
                    ),
                    {"session": session, "card": card},
                )
                connection.execute(
                    text(
                        "INSERT INTO review_events (id, session_id, position, "
                        "profile_id, entry_id, direction, rating, snapshot) VALUES "
                        "(:id, :session, 0, :profile, :card, 'greek_to_italian', "
                        '\'hard\', \'{"italian":"casa","unit": null}\')'
                    ),
                    {
                        "id": review,
                        "session": session,
                        "profile": profile,
                        "card": card,
                    },
                )
                before = (
                    connection.execute(text("SELECT * FROM review_events"))
                    .mappings()
                    .one()
                )
                original_card = (
                    connection.execute(text("SELECT * FROM vocabulary_entries"))
                    .mappings()
                    .one()
                )
                scripts.get_revision("e13f44d6a005").module.upgrade()
                after = (
                    connection.execute(text("SELECT * FROM vocabulary_entries"))
                    .mappings()
                    .one()
                )
                assert {k: v for k, v in after.items() if k != "unit_id"} == {
                    k: v for k, v in original_card.items() if k != "unit_id"
                }
                assert (
                    connection.execute(text("SELECT * FROM review_events"))
                    .mappings()
                    .one()
                    == before
                )
                fallback = connection.scalar(
                    text("SELECT id FROM units WHERE title = 'Χωρίς ταξινόμηση'")
                )
                assert after["unit_id"] == fallback
                assert set(
                    connection.scalars(
                        text("SELECT unit_id FROM profile_practice_units")
                    )
                ) == {unit, fallback}
                # Explicit empty selection stays empty; new units do not opt anyone in.
                connection.execute(text("DELETE FROM profile_practice_units"))
                connection.execute(
                    text(
                        "INSERT INTO units (id, code, title, sort_order) VALUES "
                        "(:id, 'NEW', 'Future', 0)"
                    ),
                    {"id": uuid4()},
                )
                assert (
                    connection.scalar(
                        text("SELECT count(*) FROM profile_practice_units")
                    )
                    == 0
                )
                with pytest.raises(IntegrityError), connection.begin_nested():
                    connection.execute(
                        text("DELETE FROM units WHERE id = :id"), {"id": fallback}
                    )
                with pytest.raises(IntegrityError), connection.begin_nested():
                    connection.execute(
                        text("UPDATE vocabulary_entries SET unit_id = NULL")
                    )
                scripts.get_revision("f24a55e7b006").module.upgrade()
                assert (
                    connection.scalar(
                        text("SELECT to_regclass('profile_practice_units')")
                    )
                    is None
                )
                assert (
                    connection.execute(text("SELECT * FROM review_events"))
                    .mappings()
                    .one()
                    == before
                )
                assert (
                    connection.scalar(text("SELECT unit_id FROM vocabulary_entries"))
                    == fallback
                )
            connection.rollback()
        finally:
            connection.rollback()
            connection.execute(text("SET search_path TO public"))
            connection.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
            connection.commit()
    engine.dispose()
