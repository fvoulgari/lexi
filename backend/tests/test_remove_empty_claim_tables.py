"""A cleanup must never silently discard late recovery records."""

from pathlib import Path

import pytest
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.operations import Operations
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, inspect, text


@pytest.mark.parametrize(
    "table", ["legacy_claim_continuations", "legacy_resolution_cases"]
)
def test_cleanup_refuses_nonempty_tables(test_database, table):
    migration = (
        ScriptDirectory.from_config(
            Config(str(Path(__file__).parents[1] / "alembic.ini"))
        )
        .get_revision("d14f06c7d016")
        .module
    )
    engine = create_engine(test_database)
    with engine.connect() as db:
        transaction = db.begin()
        try:
            db.execute(text("CREATE TABLE legacy_claim_continuations (id integer)"))
            db.execute(text("CREATE TABLE legacy_resolution_cases (id integer)"))
            db.execute(text(f"INSERT INTO {table} VALUES (1)"))
            with Operations.context(MigrationContext.configure(db)):
                with pytest.raises(RuntimeError, match="contains records"):
                    migration.upgrade()
            assert inspect(db).has_table("legacy_claim_continuations")
            assert inspect(db).has_table("legacy_resolution_cases")
            assert db.scalar(text(f"SELECT count(*) FROM {table}")) == 1
        finally:
            transaction.rollback()
    engine.dispose()
