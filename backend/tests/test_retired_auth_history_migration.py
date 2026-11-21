"""Retiring claim and gate history must leave learning and links intact."""

from pathlib import Path
from uuid import uuid4

from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.operations import Operations
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, inspect, text


def test_retired_history_drop_preserves_learner_records(test_database):
    engine = create_engine(test_database)
    schema = "retired_history_" + uuid4().hex
    migration = (
        ScriptDirectory.from_config(
            Config(str(Path(__file__).parents[1] / "alembic.ini"))
        )
        .get_revision("e25a17d8e017")
        .module
    )
    with engine.connect() as db:
        transaction = db.begin()
        try:
            db.execute(text(f'CREATE SCHEMA "{schema}"'))
            db.execute(text(f'SET LOCAL search_path TO "{schema}"'))
            for name in (
                "legacy_claim_links",
                "legacy_progress_requests",
                "gate_sessions",
            ):
                db.execute(text(f"CREATE TABLE {name} (id integer PRIMARY KEY)"))
                db.execute(text(f"INSERT INTO {name} VALUES (1)"))
            db.execute(
                text(
                    "CREATE TABLE learning_progress (profile_id uuid, "
                    "entry_id uuid, reviews integer, hard integer)"
                )
            )
            profile, card = uuid4(), uuid4()
            db.execute(
                text("INSERT INTO learning_progress VALUES (:p,:c,7,3)"),
                {"p": profile, "c": card},
            )
            db.execute(
                text(
                    "CREATE FUNCTION anonymize_deleted_recovery_request() "
                    "RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$"
                )
            )
            with Operations.context(MigrationContext.configure(db)):
                migration.upgrade()
            for name in (
                "legacy_claim_links",
                "legacy_progress_requests",
                "gate_sessions",
            ):
                assert not inspect(db).has_table(name)
            row = db.execute(text("SELECT * FROM learning_progress")).one()
            assert row == (profile, card, 7, 3)
        finally:
            transaction.rollback()
            engine.dispose()
