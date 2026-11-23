"""The card-language constraint migration guards existing content."""

from pathlib import Path
from uuid import uuid4

import pytest
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.operations import Operations
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, text
from sqlalchemy.exc import IntegrityError

REVISION = "f7a12b4c0001"


@pytest.mark.parametrize("valid", [True, False])
def test_card_language_constraint_migration(test_database, valid):
    engine = create_engine(test_database)
    schema = "card_languages_" + uuid4().hex
    scripts = ScriptDirectory.from_config(
        Config(str(Path(__file__).parents[1] / "alembic.ini"))
    )
    revision = scripts.get_revision(REVISION)
    card = uuid4()
    source, target = ("it", "el") if valid else ("xx", "el")
    with engine.connect() as db:
        try:
            db.execute(text(f'CREATE SCHEMA "{schema}"'))
            db.execute(text(f'SET search_path TO "{schema}"'))
            db.execute(
                text(
                    "CREATE TABLE vocabulary_entries ("
                    "id uuid PRIMARY KEY, source_language varchar(16), "
                    "target_language varchar(16))"
                )
            )
            db.execute(
                text(
                    "INSERT INTO vocabulary_entries "
                    "(id, source_language, target_language) "
                    "VALUES (:id, :source, :target)"
                ),
                {"id": card, "source": source, "target": target},
            )
            db.commit()
            with Operations.context(MigrationContext.configure(db)):
                if valid:
                    revision.module.upgrade()
                    db.commit()
                    assert db.execute(
                        text(
                            "SELECT source_language, target_language "
                            "FROM vocabulary_entries WHERE id=:id"
                        ),
                        {"id": card},
                    ).one() == (source, target)
                    with pytest.raises(IntegrityError):
                        with db.begin_nested():
                            db.execute(
                                text(
                                    "INSERT INTO vocabulary_entries "
                                    "(id, source_language, target_language) "
                                    "VALUES (:id, 'it', 'it')"
                                ),
                                {"id": uuid4()},
                            )
                else:
                    with pytest.raises(RuntimeError, match="unsupported card language"):
                        revision.module.upgrade()
                    db.rollback()
        finally:
            db.rollback()
            db.execute(text("SET search_path TO public"))
            db.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
            db.commit()
    engine.dispose()
