"""Removing Units retains original card classification and fails closed."""

from pathlib import Path
from uuid import uuid4

import pytest
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.operations import Operations
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.exc import DBAPIError


@pytest.mark.parametrize(
    "case", ["match", "published", "missing_membership", "foreign_duplicate"]
)
def test_drop_units_preserves_collection_provenance_or_rolls_back(test_database, case):
    engine = create_engine(test_database)
    schema = "remove_units_" + uuid4().hex
    module = (
        ScriptDirectory.from_config(
            Config(str(Path(__file__).parents[1] / "alembic.ini"))
        )
        .get_revision("a47c39f0a019")
        .module
    )
    unit, collection, owner, card = [uuid4() for _ in range(4)]
    with engine.connect() as db:
        tx = db.begin()
        try:
            db.execute(text(f'CREATE SCHEMA "{schema}"'))
            db.execute(text(f'SET LOCAL search_path TO "{schema}"'))
            db.execute(
                text(
                    "CREATE TABLE units (id uuid PRIMARY KEY, "
                    "owner_account_id uuid, code text, title text, "
                    "sort_order int, visibility text)"
                )
            )
            db.execute(
                text(
                    "CREATE TABLE collections (id uuid PRIMARY KEY, "
                    "owner_account_id uuid, visibility text, source_unit_id uuid, "
                    "source_unit_code text, source_unit_title text, "
                    "source_unit_sort_order int)"
                )
            )
            db.execute(
                text(
                    "CREATE TABLE vocabulary_entries (id uuid PRIMARY KEY, "
                    "unit_id uuid REFERENCES units(id))"
                )
            )
            db.execute(
                text(
                    "CREATE TABLE collection_entries "
                    "(collection_id uuid, entry_id uuid)"
                )
            )
            db.execute(
                text("INSERT INTO units VALUES (:u,:o,'00','Welcome',7,'private')"),
                {"u": unit, "o": owner},
            )
            db.execute(
                text(
                    "INSERT INTO collections VALUES "
                    "(:c,:o,'private',:u,'00','Welcome',7)"
                ),
                {"c": collection, "o": owner, "u": unit},
            )
            if case == "published":
                db.execute(text("UPDATE collections SET visibility='published'"))
            db.execute(
                text("INSERT INTO vocabulary_entries VALUES (:c,:u)"),
                {"c": card, "u": unit},
            )
            if case != "missing_membership":
                db.execute(
                    text("INSERT INTO collection_entries VALUES (:c,:e)"),
                    {"c": collection, "e": card},
                )
            if case == "foreign_duplicate":
                foreign = uuid4()
                db.execute(
                    text(
                        "INSERT INTO collections VALUES "
                        "(:c,:o,'private',:u,'wrong','Wrong',7)"
                    ),
                    {"c": foreign, "o": uuid4(), "u": unit},
                )
                db.execute(
                    text("INSERT INTO collection_entries VALUES (:c,:e)"),
                    {"c": foreign, "e": card},
                )
            with Operations.context(MigrationContext.configure(db)):
                if case == "missing_membership":
                    savepoint = db.begin_nested()
                    with pytest.raises(DBAPIError):
                        module.upgrade()
                    savepoint.rollback()
                    assert inspect(db).has_table("units")
                    assert (
                        db.scalar(text("SELECT unit_id FROM vocabulary_entries"))
                        == unit
                    )
                else:
                    module.upgrade()
                    assert not inspect(db).has_table("units")
                    assert db.scalar(
                        text("SELECT visibility FROM collections WHERE id=:id"),
                        {"id": collection},
                    ) == ("published" if case == "published" else "private")
                    assert db.execute(
                        text("SELECT id,source_collection_id FROM vocabulary_entries")
                    ).one() == (card, collection)
                    assert db.scalar(
                        text(
                            "SELECT count(*) FROM collection_entries WHERE entry_id=:id"
                        ),
                        {"id": card},
                    ) == (2 if case == "foreign_duplicate" else 1)
        finally:
            tx.rollback()
            engine.dispose()
