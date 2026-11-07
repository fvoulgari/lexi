"""Real migration preserves IDs/audience/history and refuses ambiguous pairs."""

import json
from pathlib import Path
from uuid import uuid4

import pytest
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.operations import Operations
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, text
from sqlalchemy.exc import IntegrityError


@pytest.mark.parametrize("ambiguous", [False, True])
def test_collection_backfill_preserves_rows_or_reports_ambiguity(
    test_database, ambiguous
):
    engine = create_engine(test_database)
    schema = "collections_migration_" + uuid4().hex
    scripts = ScriptDirectory.from_config(
        Config(str(Path(__file__).parents[1] / "alembic.ini"))
    )
    profile, account, unit, card, other, collection, session, review = [
        uuid4() for _ in range(8)
    ]
    with engine.connect() as db:
        try:
            db.execute(text(f'CREATE SCHEMA "{schema}"'))
            db.execute(text(f'SET search_path TO "{schema}"'))
            with Operations.context(MigrationContext.configure(db)):
                for revision in reversed(
                    list(scripts.walk_revisions(base="base", head="b46d77a9d009"))
                ):
                    revision.module.upgrade()

                def insert(table, **values):
                    columns = ",".join(values)
                    binds = ",".join(
                        f"CAST(:{k} AS json)" if k == "snapshot" else f":{k}"
                        for k in values
                    )
                    db.execute(
                        text(f"INSERT INTO {table} ({columns}) VALUES ({binds})"),
                        values,
                    )

                insert(
                    "profiles",
                    id=profile,
                    display_name="Synthetic",
                    preferred_direction="greek_to_italian",
                )
                insert(
                    "accounts",
                    id=account,
                    provider_subject="synthetic",
                    profile_id=profile,
                )
                insert("units", id=unit, code="OLD", title="Legacy", sort_order=0)
                for key in [card, other]:
                    insert(
                        "vocabulary_entries",
                        id=key,
                        italian="ciao",
                        greek="γεια",
                        word_type="expression",
                        unit_id=unit,
                    )
                insert(
                    "collections",
                    id=collection,
                    owner_account_id=account,
                    title="Old collection",
                )
                for key in [card, other]:
                    insert("collection_entries", collection_id=collection, entry_id=key)
                insert(
                    "practice_sessions",
                    id=session,
                    profile_id=profile,
                    direction="italian_to_greek",
                    requested_size=10,
                    available=1,
                )
                snapshot = json.dumps({"italian": "ciao", "greek": "γεια"})
                insert(
                    "session_cards",
                    session_id=session,
                    position=0,
                    entry_id=card,
                    snapshot=snapshot,
                )
                insert(
                    "review_events",
                    id=review,
                    session_id=session,
                    position=0,
                    profile_id=profile,
                    entry_id=card,
                    direction="italian_to_greek",
                    rating="hard",
                    snapshot=snapshot,
                )
                now = db.scalar(text("SELECT now()"))
                insert(
                    "learning_progress",
                    profile_id=profile,
                    entry_id=card,
                    direction="italian_to_greek",
                    reviews=1,
                    again=0,
                    hard=1,
                    easy=0,
                    weighted_sum=0.5,
                    weight=1,
                    last_reviewed_at=now,
                )
                if ambiguous:
                    db.execute(
                        text(
                            "UPDATE vocabulary_entries SET "
                            "source_language='en',target_language='da' "
                            "WHERE id=:id"
                        ),
                        {"id": other},
                    )
                tables = [
                    "vocabulary_entries",
                    "collections",
                    "collection_entries",
                    "profiles",
                    "accounts",
                    "session_cards",
                    "review_events",
                    "learning_progress",
                    "practice_sessions",
                ]
                before = {
                    t: list(db.execute(text(f"SELECT * FROM {t}")).mappings())
                    for t in tables
                }
                migration = scripts.get_revision("c57e88b0e010").module
                if ambiguous:
                    with pytest.raises(RuntimeError, match=str(collection)):
                        migration.upgrade()
                    columns = db.scalar(
                        text(
                            "SELECT count(*) FROM information_schema.columns "
                            "WHERE table_schema=:schema AND table_name='collections' "
                            "AND column_name='visibility'"
                        ),
                        {"schema": schema},
                    )
                    assert columns == 0
                else:
                    migration.upgrade()

                    def canonical(rows):
                        return sorted(
                            json.dumps(dict(r), sort_keys=True, default=str)
                            for r in rows
                        )

                    for table, old in before.items():
                        columns = ",".join(old[0])
                        after = db.execute(text(f"SELECT {columns} FROM {table}"))
                        assert canonical(after.mappings()) == canonical(old)
                    row = db.execute(
                        text(
                            "SELECT source_language,target_language,"
                            "visibility FROM collections"
                        )
                    ).one()
                    assert tuple(row) == ("el", "it", "private")
                    assert list(
                        db.scalars(
                            text(
                                "SELECT position FROM "
                                "collection_entries ORDER BY "
                                "entry_id"
                            )
                        )
                    ) == [0, 1]
                    # Rehearse the follow-up from the already-applied draft:
                    # owned publication is collection-derived; unowned published
                    # library cards must remain independently published.
                    db.execute(
                        text(
                            "UPDATE vocabulary_entries SET visibility='published', "
                            "owner_account_id=:owner,source_language='el', "
                            "target_language='it', "
                            "italian='γεια',greek='ciao', "
                            "italian_gender='masculine',greek_gender='neuter' "
                            "WHERE id=:id"
                        ),
                        {"id": card, "owner": account},
                    )
                    db.execute(
                        text(
                            "UPDATE vocabulary_entries SET visibility='published' "
                            "WHERE id=:id"
                        ),
                        {"id": other},
                    )
                    snapshots = list(
                        db.execute(text("SELECT snapshot FROM session_cards")).scalars()
                    )
                    history = list(
                        db.execute(text("SELECT * FROM learning_progress")).mappings()
                    )
                    scripts.get_revision("d68f99c1f011").module.upgrade()
                    normalized = db.execute(
                        text(
                            "SELECT italian,greek,source_language,target_language, "
                            "italian_gender,greek_gender,visibility,owner_account_id "
                            "FROM vocabulary_entries WHERE id=:id"
                        ),
                        {"id": card},
                    ).one()
                    assert tuple(normalized) == (
                        "ciao",
                        "γεια",
                        "it",
                        "el",
                        "masculine",
                        "neuter",
                        "private",
                        account,
                    )
                    assert (
                        db.scalar(
                            text(
                                "SELECT visibility FROM vocabulary_entries WHERE id=:id"
                            ),
                            {"id": other},
                        )
                        == "published"
                    )
                    assert (
                        list(
                            db.execute(
                                text("SELECT snapshot FROM session_cards")
                            ).scalars()
                        )
                        == snapshots
                    )
                    assert canonical(
                        db.execute(text("SELECT * FROM learning_progress")).mappings()
                    ) == canonical(history)
                    assert (
                        db.scalar(
                            text(
                                "SELECT count(*) FROM collection_entries "
                                "WHERE publication_confirmed"
                            )
                        )
                        == 0
                    )
                    assert (
                        db.scalar(text("SELECT count(*) FROM collection_entries")) == 2
                    )
                    db.execute(
                        text("DELETE FROM collection_entries WHERE entry_id=:id"),
                        {"id": other},
                    )
                    db.execute(
                        text(
                            "UPDATE vocabulary_entries SET "
                            "source_language='en',target_language='da' "
                            "WHERE id=:id"
                        ),
                        {"id": other},
                    )
                    with pytest.raises(IntegrityError):
                        with db.begin_nested():
                            insert(
                                "collection_entries",
                                collection_id=collection,
                                entry_id=other,
                                position=1,
                            )
        finally:
            db.rollback()
            db.execute(text("SET search_path TO public"))
            db.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
            db.commit()
    engine.dispose()
