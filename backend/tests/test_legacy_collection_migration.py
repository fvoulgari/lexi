from uuid import UUID, uuid4

import pytest
from sqlalchemy import bindparam, create_engine, text

from app.legacy_collection_migration import migrate
from app.preservation_manifest import compare, snapshot


def fixture(db):
    # Isolate Unit 00 from other tests; the transaction is rolled back.
    db.execute(text("TRUNCATE TABLE units CASCADE"))
    people = [(uuid4(), uuid4()), (uuid4(), uuid4())]
    for account, profile in people:
        db.execute(
            text(
                "INSERT INTO profiles (id,display_name,preferred_direction) "
                "VALUES (:id,'synthetic','italian_to_greek')"
            ),
            {"id": profile},
        )
        db.execute(
            text(
                "INSERT INTO accounts (id,profile_id,provider_subject) "
                "VALUES (:id,:profile,:subject)"
            ),
            {"id": account, "profile": profile, "subject": str(account)},
        )
    suffix = uuid4().hex
    mapping, card_ids = [], []
    for i, (code, title) in enumerate(
        [("00", "Benvenuti"), ("30", "Foods"), ("50", "Days"), ("610", "Lorenzo")]
    ):
        unit_id = uuid4()
        account, profile = people[0 if i == 0 else 1]
        db.execute(
            text(
                "INSERT INTO units (id,code,title,sort_order) "
                "VALUES (:id,:code,:title,:n)"
            ),
            {"id": unit_id, "code": code, "title": title, "n": i},
        )
        if i < 3:
            card_id = uuid4()
            card_ids.append(card_id)
            db.execute(
                text(
                    "INSERT INTO vocabulary_entries "
                    "(id,unit_id,italian,greek,word_type) "
                    "VALUES (:id,:unit,'ciao','γεια','expression')"
                ),
                {"id": card_id, "unit": unit_id},
            )
        mapping.append(
            {
                "unit_id": str(unit_id),
                "account_id": str(account),
                "profile_id": str(profile),
                "code": code,
                "unit_title": title,
                "collection_title": f"{code} · {title} {suffix}",
                "expected_cards": int(i < 3),
                "expected_card_ids": [str(card_ids[-1])] if i < 3 else [],
            }
        )
    tag = uuid4()
    db.execute(text("INSERT INTO tags (id,name) VALUES (:id,'synthetic')"), {"id": tag})
    db.execute(
        text("INSERT INTO entry_tags (entry_id,tag_id) VALUES (:card,:tag)"),
        {"card": card_ids[0], "tag": tag},
    )
    return mapping, card_ids, tag


def test_migration_is_idempotent_and_preserves_rows(test_database):
    engine = create_engine(test_database)
    with engine.connect() as db:
        tx = db.begin()
        try:
            mapping, cards, tag = fixture(db)
            before = snapshot(db)
            first = migrate(db, mapping)
            after = snapshot(db)
            changes = compare(before, after)
            assert {c["table"] for c in changes} == {
                "units",
                "vocabulary_entries",
                "tags",
                "collections",
                "collection_entries",
            }
            assert all(
                c["change"] == "row_added"
                or set(c["columns"]) <= {"owner_account_id", "visibility"}
                for c in changes
            )
            assert [x["new_memberships"] for x in first] == [1, 1, 1, 0]
            assert [x["tags"] for x in first] == [1, 0, 0, 0]
            second = migrate(db, mapping)
            assert all(not x["created"] and x["new_memberships"] == 0 for x in second)
            assert (
                db.execute(
                    text(
                        "SELECT count(*) FROM entry_tags "
                        "WHERE tag_id=:tag AND entry_id=:card"
                    ),
                    {"tag": tag, "card": cards[0]},
                ).scalar_one()
                == 1
            )
            assert db.execute(
                text("SELECT italian,greek FROM vocabulary_entries WHERE id=:id"),
                {"id": cards[0]},
            ).one() == ("ciao", "γεια")
            assert (
                db.execute(
                    text(
                        "SELECT count(*) FROM collections WHERE id IN :ids"
                    ).bindparams(bindparam("ids", expanding=True)),
                    {"ids": [UUID(x["collection_id"]) for x in first]},
                ).scalar_one()
                == 4
            )
        finally:
            tx.rollback()
    engine.dispose()


def test_shared_tag_is_reported_without_mutating_unrelated_cards(test_database):
    engine = create_engine(test_database)
    with engine.connect() as db:
        tx = db.begin()
        try:
            mapping, cards, tag = fixture(db)
            db.execute(
                text("INSERT INTO entry_tags (entry_id,tag_id) VALUES (:card,:tag)"),
                {"card": cards[1], "tag": tag},
            )
            with pytest.raises(ValueError, match="shared with another Unit"):
                migrate(db, mapping)
            assert (
                db.execute(
                    text("SELECT owner_account_id FROM tags WHERE id=:tag"),
                    {"tag": tag},
                ).scalar_one()
                is None
            )
        finally:
            tx.rollback()
    engine.dispose()


def test_late_conflict_rolls_back_earlier_group(test_database):
    engine = create_engine(test_database)
    with engine.connect() as db:
        tx = db.begin()
        try:
            mapping, cards, _ = fixture(db)
            other = UUID(mapping[0]["account_id"])
            db.execute(
                text(
                    "UPDATE vocabulary_entries SET owner_account_id=:owner, "
                    "visibility='private' WHERE id=:card"
                ),
                {"owner": other, "card": cards[1]},
            )
            savepoint = db.begin_nested()
            with pytest.raises(ValueError, match="Card ownership conflict"):
                migrate(db, mapping)
            savepoint.rollback()
            assert (
                db.execute(
                    text("SELECT owner_account_id FROM units WHERE id=:id"),
                    {"id": UUID(mapping[0]["unit_id"])},
                ).scalar_one()
                is None
            )
            assert (
                db.execute(
                    text("SELECT count(*) FROM collections WHERE title=:title"),
                    {"title": mapping[0]["collection_title"]},
                ).scalar_one()
                == 0
            )
        finally:
            tx.rollback()
    engine.dispose()


def test_remaining_legacy_content_stops_retirement(test_database):
    engine = create_engine(test_database)
    with engine.connect() as db:
        tx = db.begin()
        try:
            mapping, _, _ = fixture(db)
            extra = uuid4()
            db.execute(
                text(
                    "INSERT INTO units (id,code,title,sort_order) "
                    "VALUES (:id,'unreviewed','Unreviewed',9)"
                ),
                {"id": extra},
            )
            savepoint = db.begin_nested()
            with pytest.raises(ValueError, match="legacy units remain"):
                migrate(db, mapping)
            savepoint.rollback()
            assert (
                db.execute(
                    text("SELECT owner_account_id FROM units WHERE id=:id"),
                    {"id": UUID(mapping[0]["unit_id"])},
                ).scalar_one()
                is None
            )
        finally:
            tx.rollback()
    engine.dispose()
