"""Expiry-index cleanup preserves retired authentication records."""

from pathlib import Path

import pytest
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.operations import Operations
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, inspect, text


def migration():
    scripts = ScriptDirectory.from_config(
        Config(str(Path(__file__).parents[1] / "alembic.ini"))
    )
    return scripts.get_revision("a91c73f4a014").module


def test_expiry_index_cleanup_preserves_rows_and_is_reversible(test_database):
    engine = create_engine(test_database)
    with engine.connect() as db:
        tx = db.begin()
        try:
            db.execute(
                text(
                    "CREATE INDEX ix_gate_sessions_expires_at "
                    "ON gate_sessions (expires_at)"
                )
            )
            db.execute(
                text(
                    "CREATE INDEX ix_legacy_claim_continuations_expires_at "
                    "ON legacy_claim_continuations (expires_at)"
                )
            )
            db.execute(
                text(
                    "INSERT INTO gate_sessions (token_hash, expires_at) "
                    "VALUES (:key, now())"
                ),
                {"key": "g" * 64},
            )
            db.execute(
                text(
                    "INSERT INTO legacy_claim_continuations "
                    "(secret_hash, token_hash, expires_at) "
                    "VALUES (:secret, :token, now())"
                ),
                {"secret": "s" * 64, "token": "t" * 64},
            )
            module = migration()
            with Operations.context(MigrationContext.configure(db)):
                module.upgrade()
                module.upgrade()
                for table, name in module.INDEXES:
                    assert name not in {
                        i["name"] for i in inspect(db).get_indexes(table)
                    }
                assert (
                    db.execute(
                        text(
                            "SELECT count(*) FROM gate_sessions WHERE token_hash=:key"
                        ),
                        {"key": "g" * 64},
                    ).scalar_one()
                    == 1
                )
                assert (
                    db.execute(
                        text(
                            "SELECT count(*) FROM legacy_claim_continuations "
                            "WHERE secret_hash=:key"
                        ),
                        {"key": "s" * 64},
                    ).scalar_one()
                    == 1
                )
                module.downgrade()
                module.downgrade()
                for table, name in module.INDEXES:
                    assert name in {i["name"] for i in inspect(db).get_indexes(table)}
        finally:
            tx.rollback()
            engine.dispose()


def test_cleanup_refuses_a_different_index_definition(test_database):
    engine = create_engine(test_database)
    with engine.connect() as db:
        tx = db.begin()
        try:
            db.execute(
                text(
                    "CREATE INDEX ix_gate_sessions_expires_at "
                    "ON gate_sessions (token_hash)"
                )
            )
            with Operations.context(MigrationContext.configure(db)):
                with pytest.raises(RuntimeError, match="Unexpected definition"):
                    migration().upgrade()
            assert "ix_gate_sessions_expires_at" in {
                i["name"] for i in inspect(db).get_indexes("gate_sessions")
            }
        finally:
            tx.rollback()
            engine.dispose()
