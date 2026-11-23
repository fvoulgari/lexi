"""Registry-backed language integrity keeps data intact without schema changes."""

import os
from contextlib import contextmanager
from pathlib import Path
from uuid import uuid4

import pytest
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.operations import Operations
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.exc import IntegrityError

from app.languages import DIRECTION_PAIRS, LANGUAGES

REVISION = "c1e0d5f7a901"


def _revision():
    scripts = ScriptDirectory.from_config(
        Config(str(Path(__file__).parents[1] / "alembic.ini"))
    )
    return scripts.get_revision(REVISION)


@contextmanager
def legacy_schema(engine):
    schema = "language_registry_" + uuid4().hex
    with engine.connect() as db:
        db.execute(text(f'CREATE SCHEMA "{schema}"'))
        db.execute(text(f'SET search_path TO "{schema}"'))
        try:
            yield db
        finally:
            db.rollback()
            db.execute(text("SET search_path TO public"))
            db.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
            db.commit()


def _create_legacy_tables(db):
    language_values = ", ".join(repr(code) for code in LANGUAGES)
    direction_values = ", ".join(repr(key) for key in DIRECTION_PAIRS)
    db.execute(
        text(
            "CREATE TABLE vocabulary_entries ("
            "id uuid PRIMARY KEY, source_language varchar(16), "
            "target_language varchar(16), visibility varchar(16), "
            "owner_account_id uuid, "
            "CONSTRAINT vocabulary_card_languages CHECK ("
            f"source_language IN ({language_values}) AND "
            f"target_language IN ({language_values}) AND "
            "source_language <> target_language))"
        )
    )
    db.execute(
        text(
            "CREATE TABLE collections ("
            "id uuid PRIMARY KEY, source_language varchar(16), "
            "target_language varchar(16), visibility varchar(16), "
            "CONSTRAINT collection_pair CHECK ("
            f"source_language IN ({language_values}) AND "
            f"target_language IN ({language_values}) AND "
            "source_language < target_language))"
        )
    )
    db.execute(
        text(
            "CREATE TABLE review_events ("
            "id uuid PRIMARY KEY, direction varchar(24), "
            "CONSTRAINT valid_review_direction CHECK ("
            f"direction IN ({direction_values})))"
        )
    )
    db.execute(
        text(
            "CREATE TABLE learning_progress ("
            "profile_id uuid, entry_id uuid, direction varchar(24), "
            "PRIMARY KEY (profile_id, entry_id, direction))"
        )
    )
    db.execute(
        text(
            "CREATE TABLE practice_sessions ("
            "id uuid PRIMARY KEY, direction varchar(24))"
        )
    )
    db.execute(
        text(
            "CREATE TABLE session_cards ("
            "session_id uuid, position integer, revealed_direction varchar(24), "
            "PRIMARY KEY (session_id, position))"
        )
    )


def _insert_legacy_rows(db):
    card, collection, review = uuid4(), uuid4(), uuid4()
    session, profile = uuid4(), uuid4()
    db.execute(
        text(
            "INSERT INTO vocabulary_entries "
            "(id, source_language, target_language, visibility, owner_account_id) "
            "VALUES (:id, 'it', 'el', 'private', :owner)"
        ),
        {"id": card, "owner": profile},
    )
    db.execute(
        text(
            "INSERT INTO collections "
            "(id, source_language, target_language, visibility) "
            "VALUES (:id, 'el', 'it', 'private')"
        ),
        {"id": collection},
    )
    db.execute(
        text(
            "INSERT INTO review_events (id, direction) "
            "VALUES (:id, 'greek_to_italian')"
        ),
        {"id": review},
    )
    db.execute(
        text(
            "INSERT INTO learning_progress (profile_id, entry_id, direction) "
            "VALUES (:profile, :entry, 'greek_to_italian')"
        ),
        {"profile": profile, "entry": card},
    )
    db.execute(
        text(
            "INSERT INTO practice_sessions (id, direction) "
            "VALUES (:id, 'greek_to_italian')"
        ),
        {"id": session},
    )
    db.execute(
        text(
            "INSERT INTO session_cards (session_id, position, revealed_direction) "
            "VALUES (:session, 0, 'greek_to_italian')"
        ),
        {"session": session},
    )
    db.commit()
    return card, collection, review, session, profile


def test_registry_migration_preserves_rows_and_adds_integrity(test_database):
    engine = create_engine(test_database)
    revision = _revision()
    with legacy_schema(engine) as db:
        _create_legacy_tables(db)
        _insert_legacy_rows(db)
        with Operations.context(MigrationContext.configure(db)):
            revision.module.upgrade()
        db.commit()

        assert (
            db.execute(text("SELECT count(*) FROM languages")).scalar()
            == len(LANGUAGES)
        )
        assert (
            db.execute(text("SELECT count(*) FROM practice_directions")).scalar()
            == len(DIRECTION_PAIRS)
        )
        assert db.execute(
            text("SELECT source_language, target_language FROM vocabulary_entries")
        ).one() == ("it", "el")
        assert db.execute(
            text("SELECT direction FROM review_events")
        ).scalar() == "greek_to_italian"

        foreign_keys = {
            constraint["name"]
            for constraint in inspect(db).get_foreign_keys("vocabulary_entries")
        }
        assert {
            "fk_vocabulary_source_language",
            "fk_vocabulary_target_language",
        } <= foreign_keys
        assert "fk_review_direction" in {
            constraint["name"]
            for constraint in inspect(db).get_foreign_keys("review_events")
        }

        with pytest.raises(IntegrityError):
            with db.begin_nested():
                db.execute(
                    text(
                        "INSERT INTO vocabulary_entries "
                        "(id, source_language, target_language) "
                        "VALUES (:id, 'xx', 'el')"
                    ),
                    {"id": uuid4()},
                )
        with pytest.raises(IntegrityError):
            with db.begin_nested():
                db.execute(
                    text(
                        "INSERT INTO review_events (id, direction) "
                        "VALUES (:id, 'xx_to_en')"
                    ),
                    {"id": uuid4()},
                )
        with pytest.raises(IntegrityError):
            with db.begin_nested():
                db.execute(text("DELETE FROM languages WHERE id = 'it'"))

        # A new language and its direction are data, never a schema change.
        db.execute(
            text("INSERT INTO languages (id, display_name) VALUES ('xx', 'Synthetic')")
        )
        db.execute(
            text(
                "INSERT INTO practice_directions "
                "(name, prompt_language, answer_language) "
                "VALUES ('xx_to_en', 'xx', 'en')"
            )
        )
        card = uuid4()
        db.execute(
            text(
                "INSERT INTO vocabulary_entries "
                "(id, source_language, target_language) VALUES (:id, 'xx', 'en')"
            ),
            {"id": card},
        )
        db.commit()

        db.execute(text("DELETE FROM vocabulary_entries WHERE id = :id"), {"id": card})
        db.execute(text("DELETE FROM practice_directions WHERE name = 'xx_to_en'"))
        db.execute(text("DELETE FROM languages WHERE id = 'xx'"))
        db.commit()
        with Operations.context(MigrationContext.configure(db)):
            revision.module.downgrade()
        db.commit()
        inspector = inspect(db)
        assert not inspector.has_table("languages")
        assert "valid_review_direction" in {
            constraint["name"]
            for constraint in inspector.get_check_constraints("review_events")
        }
    engine.dispose()


def test_registry_migration_refuses_unregistered_existing_values(test_database):
    engine = create_engine(test_database)
    revision = _revision()
    with legacy_schema(engine) as db:
        _create_legacy_tables(db)
        _insert_legacy_rows(db)
        db.execute(
            text(
                "UPDATE practice_sessions SET direction = 'xx_to_en' "
                "WHERE direction = 'greek_to_italian'"
            )
        )
        db.commit()
        with Operations.context(MigrationContext.configure(db)):
            with pytest.raises(RuntimeError, match="unsupported language registry"):
                revision.module.upgrade()
        db.rollback()
    engine.dispose()


def test_seeded_registry_is_enforced_by_the_database(client):
    engine = create_engine(os.environ["DATABASE_URL"])
    with engine.connect() as db:
        assert set(db.scalars(text("SELECT id FROM languages"))) == set(LANGUAGES)
        assert set(db.scalars(text("SELECT name FROM practice_directions"))) == set(
            DIRECTION_PAIRS
        )
        owner = db.execute(text("SELECT id FROM accounts LIMIT 1")).scalar_one()
        with pytest.raises(IntegrityError):
            with db.begin_nested():
                db.execute(
                    text(
                        "INSERT INTO vocabulary_entries "
                        "(id, source_language, target_language, word_type, visibility, "
                        "owner_account_id, italian, greek) "
                        "VALUES (:id, 'zz', 'en', 'noun', 'private', :owner, 'a', 'b')"
                    ),
                    {"id": uuid4(), "owner": owner},
                )
        with pytest.raises(IntegrityError):
            with db.begin_nested():
                db.execute(text("DELETE FROM languages WHERE id = 'it'"))

        db.execute(
            text("INSERT INTO languages (id, display_name) VALUES ('zz', 'Synthetic')")
        )
        db.execute(
            text(
                "INSERT INTO practice_directions "
                "(name, prompt_language, answer_language) "
                "VALUES ('zz_to_en', 'zz', 'en')"
            )
        )
        db.execute(
            text(
                "INSERT INTO collections "
                "(id, title, source_language, target_language, visibility, "
                "owner_account_id) "
                "VALUES (:id, 'Synthetic', 'en', 'zz', 'private', :owner)"
            ),
            {"id": uuid4(), "owner": owner},
        )
        db.execute(
            text(
                "INSERT INTO vocabulary_entries "
                "(id, source_language, target_language, word_type, visibility, "
                "owner_account_id, italian, greek) "
                "VALUES (:id, 'en', 'zz', 'noun', 'private', :owner, 'a', 'b')"
            ),
            {"id": uuid4(), "owner": owner},
        )
        db.commit()
    engine.dispose()
