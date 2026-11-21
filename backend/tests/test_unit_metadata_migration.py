"""Copy legacy Unit metadata only where Collection mapping is unambiguous."""

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
    "case", ["match", "missing", "ambiguous", "missing_card", "wrong_audience"]
)
def test_unit_metadata_copy_is_lossless_or_fails_closed(test_database, case):
    engine = create_engine(test_database)
    schema = "unit_metadata_" + uuid4().hex
    migration = (
        ScriptDirectory.from_config(
            Config(str(Path(__file__).parents[1] / "alembic.ini"))
        )
        .get_revision("f36b28e9f018")
        .module
    )
    unit, owner, collection, card = [uuid4() for _ in range(4)]
    with engine.connect() as db:
        tx = db.begin()
        try:
            db.execute(text(f'CREATE SCHEMA "{schema}"'))
            db.execute(text(f'SET LOCAL search_path TO "{schema}"'))
            db.execute(
                text(
                    "CREATE TABLE units (id uuid, owner_account_id uuid, "
                    "code text, title text, sort_order integer, visibility text)"
                )
            )
            db.execute(
                text(
                    "CREATE TABLE collections (id uuid, owner_account_id uuid, "
                    "title text, visibility text)"
                )
            )
            db.execute(text("CREATE TABLE vocabulary_entries (id uuid, unit_id uuid)"))
            db.execute(
                text(
                    "CREATE TABLE collection_entries (collection_id uuid, "
                    "entry_id uuid)"
                )
            )
            db.execute(
                text(
                    "INSERT INTO units VALUES (:id,:owner,'00','Welcome',7,'private')"
                ),
                {"id": unit, "owner": owner},
            )
            if case != "missing":
                db.execute(
                    text(
                        "INSERT INTO collections VALUES "
                        "(:id,:owner,'00 · Welcome','private')"
                    ),
                    {"id": collection, "owner": owner},
                )
            if case == "ambiguous":
                db.execute(
                    text(
                        "INSERT INTO collections VALUES "
                        "(:id,:owner,'00 · Welcome','private')"
                    ),
                    {"id": uuid4(), "owner": owner},
                )
            if case == "wrong_audience":
                db.execute(text("UPDATE collections SET visibility='published'"))
            db.execute(
                text("INSERT INTO vocabulary_entries VALUES (:id,:unit)"),
                {"id": card, "unit": unit},
            )
            if case not in {"missing", "missing_card"}:
                db.execute(
                    text("INSERT INTO collection_entries VALUES (:collection,:card)"),
                    {"collection": collection, "card": card},
                )
            if case == "match":
                with Operations.context(MigrationContext.configure(db)):
                    migration.upgrade()
                row = db.execute(
                    text(
                        "SELECT source_unit_id,source_unit_code,"
                        "source_unit_title,source_unit_sort_order FROM collections"
                    )
                )
                assert row.one() == (unit, "00", "Welcome", 7)
                assert db.scalar(text("SELECT count(*) FROM collection_entries")) == 1
            else:
                savepoint = db.begin_nested()
                with pytest.raises(DBAPIError):
                    with Operations.context(MigrationContext.configure(db)):
                        migration.upgrade()
                savepoint.rollback()
                assert "source_unit_id" not in {
                    c["name"] for c in inspect(db).get_columns("collections")
                }
                assert db.scalar(text("SELECT count(*) FROM units")) == 1
        finally:
            tx.rollback()
            engine.dispose()
