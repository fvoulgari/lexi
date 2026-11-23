"""HTTP and PostgreSQL coverage for explicit card language IDs."""

import os
from itertools import product
from uuid import UUID, uuid4

import pytest
from conftest import TEST_CSRF
from sqlalchemy import create_engine, inspect, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.languages import LANGUAGES, card_text, direction_key
from app.models import SessionCard, VocabularyEntry

H = {"X-CSRF-Token": TEST_CSRF}


def create_collection(client, a, b, name="Languages"):
    response = client.post(
        "/api/collections",
        headers=H,
        json={"name": name, "source_language": a, "target_language": b},
    )
    assert response.status_code == 201, response.text
    return response.json()


def create_card(client, collection, a, b, source_text, target_text):
    response = client.post(
        f"/api/collections/{collection['id']}/cards",
        headers=H,
        json={
            "source_language": a,
            "target_language": b,
            "source_text": source_text,
            "target_text": target_text,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def create_session(client, account, collection, direction):
    return client.post(
        "/api/sessions",
        headers=H,
        json={
            "profile_id": account["profile_id"],
            "collection_ids": [collection["id"]],
            "direction": direction,
            "size": 10,
        },
    )


def test_every_ordered_pair_exposes_ids_and_text_by_language_id(
    client, account_client
):
    account = account_client("all-pairs")
    for source, target in product(LANGUAGES, LANGUAGES):
        if source == target:
            continue
        collection = create_collection(client, source, target)
        assert (collection["source_language"], collection["target_language"]) == tuple(
            sorted((source, target))
        )
        expected = {
            source: f"{source}-{target}-first",
            target: f"{source}-{target}-second",
        }
        card = create_card(
            client,
            collection,
            source,
            target,
            expected[source],
            expected[target],
        )
        assert set((card["source_language"], card["target_language"])) == {
            source,
            target,
        }
        for language, value in expected.items():
            assert card_text(card, language) == value

        reversed_collection = create_collection(client, target, source, "Reversed")
        added = client.post(
            f"/api/collections/{reversed_collection['id']}/entries",
            headers=H,
            json={"entry_id": card["id"]},
        )
        assert added.status_code == 204, added.text

        queue = create_session(
            client, account, collection, direction_key(source, target)
        )
        assert queue.status_code == 201, queue.text
        snapshot = queue.json()["cards"][0]["snapshot"]
        assert set((snapshot["source_language"], snapshot["target_language"])) == {
            source,
            target,
        }
        for language, value in expected.items():
            assert card_text(snapshot, language) == value


@pytest.mark.parametrize(
    "source,target",
    [("en", "en"), ("xx", "en"), ("en", "el")],
)
def test_invalid_card_language_ids_are_rejected(client, account_client, source, target):
    account_client("invalid-ids")
    collection = create_collection(client, "en", "da")
    response = client.post(
        f"/api/collections/{collection['id']}/cards",
        headers=H,
        json={
            "source_language": source,
            "target_language": target,
            "source_text": "hello",
            "target_text": "hej",
        },
    )
    assert response.status_code == 422, response.text
    assert client.get(f"/api/collections/{collection['id']}/entries").json() == []
    listing = client.get("/api/collections?source_language=it&target_language=xx")
    assert listing.status_code == 422


def test_card_language_order_is_immutable(client, account_client):
    account_client("immutable")
    collection = create_collection(client, "en", "da")
    card = create_card(client, collection, "en", "da", "hello", "hej")
    response = client.patch(
        f"/api/collections/cards/{card['id']}",
        headers=H,
        json={
            "source_language": "da",
            "target_language": "en",
            "source_text": "hej",
            "target_text": "hello",
        },
    )
    assert response.status_code == 422, response.text
    entries = client.get(f"/api/collections/{collection['id']}/entries").json()
    assert entries[0]["source_language"] == card["source_language"]
    assert entries[0]["source_text"] == "hello"


def test_legacy_vocabulary_keeps_explicit_ids_and_legacy_direction(client):
    from conftest import signin

    signin(client)
    collection = client.get("/api/collections").json()[0]
    response = client.post(
        "/api/vocabulary",
        headers=H,
        json={
            "visibility": "private",
            "collection_id": collection["id"],
            "italian": "ciao",
            "greek": "γεια",
            "word_type": "expression",
        },
    )
    assert response.status_code == 201, response.text
    entry = response.json()["entry"]
    assert (entry["source_language"], entry["target_language"]) == ("it", "el")
    assert card_text(entry, "it") == "ciao"
    assert card_text(entry, "el") == "γεια"
    session = client.get("/api/profiles").json()[0]["id"]
    queue = client.post(
        "/api/sessions",
        headers=H,
        json={
            "profile_id": session,
            "direction": "italian_to_greek",
            "collection_ids": [collection["id"]],
            "size": 10,
        },
    )
    assert queue.status_code == 201, queue.text
    path = f"/api/sessions/{queue.json()['id']}/cards/0"
    assert (
        client.post(path + "/reveal", headers=H, json={"direction": "italian_to_greek"})
    ).status_code == 200


def test_reversed_legacy_snapshot_keeps_its_text_and_review_history(
    client, account_client
):
    account = account_client("legacy-snapshot")
    collection = create_collection(client, "it", "el")
    create_card(client, collection, "it", "el", "ciao", "γεια")
    create_card(client, collection, "it", "el", "arrivederci", "γεια σου")
    queue = create_session(client, account, collection, "greek_to_italian")
    assert queue.status_code == 201, queue.text
    session_id = queue.json()["id"]
    reviewed_id = queue.json()["cards"][0]["entry_id"]

    engine = create_engine(os.environ["DATABASE_URL"])
    with Session(engine) as db:
        card = db.scalar(
            select(SessionCard).where(
                SessionCard.session_id == UUID(session_id), SessionCard.position == 0
            )
        )
        snapshot = dict(card.snapshot)
        snapshot.update(
            source_language="el",
            target_language="it",
            italian="γεια",
            greek="ciao",
        )
        card.snapshot = snapshot
        db.commit()
    engine.dispose()

    snapshot = client.get(f"/api/sessions/{session_id}").json()["cards"][0]["snapshot"]
    assert card_text(snapshot, "el") == "γεια"
    assert card_text(snapshot, "it") == "ciao"
    path = f"/api/sessions/{session_id}/cards/0"
    reviewed = client.post(
        path + "/reviews",
        headers=H,
        json={"direction": "greek_to_italian", "rating": "easy"},
    )
    assert reviewed.status_code == 409  # reveal is still required
    assert (
        client.post(
            path + "/reveal", headers=H, json={"direction": "greek_to_italian"}
        )
    ).status_code == 200
    assert (
        client.post(
            path + "/reviews",
            headers=H,
            json={"direction": "greek_to_italian", "rating": "easy"},
        )
    ).status_code == 200
    records = client.get(
        f"/api/profiles/{account['profile_id']}/learning-records"
    ).json()
    assert [
        (r["entry_id"], r["direction"], r["reviews"])
        for r in records
        if r["entry_id"] == reviewed_id
    ] == [(reviewed_id, "greek_to_italian", 1)]


def test_database_constraint_rejects_unsupported_card_ids_without_rewriting_data(
    client, account_client
):
    account = account_client("constraint")
    engine = create_engine(os.environ["DATABASE_URL"])
    columns = (
        "id,italian,greek,source_language,target_language,visibility,"
        "owner_account_id,created_at,updated_at"
    )
    card_rows = text(f"SELECT {columns} FROM vocabulary_entries")

    def rows():
        with engine.connect() as db:
            return sorted(
                tuple(str(value) if value is not None else None for value in row)
                for row in db.execute(card_rows)
            )

    before = rows()
    assert "vocabulary_card_languages" in {
        constraint["name"]
        for constraint in inspect(engine).get_check_constraints("vocabulary_entries")
    }
    with Session(engine) as db:
        for source, target in product(LANGUAGES, LANGUAGES):
            if source == target:
                continue
            db.add(
                VocabularyEntry(
                    id=uuid4(),
                    italian=source,
                    greek=target,
                    word_type="expression",
                    source_language=source,
                    target_language=target,
                    visibility="private",
                    owner_account_id=UUID(account["id"]),
                )
            )
        db.commit()
        for source, target in (("it", "it"), ("xx", "el"), ("el", "xx")):
            with pytest.raises(IntegrityError):
                with db.begin_nested():
                    db.add(
                        VocabularyEntry(
                            id=uuid4(),
                            italian="bad",
                            greek="bad",
                            word_type="expression",
                            source_language=source,
                            target_language=target,
                            visibility="private",
                            owner_account_id=UUID(account["id"]),
                        )
                    )
                    db.flush()
    engine.dispose()
    after = rows()
    assert before == [row for row in after if row in before]
    assert len(after) - len(before) == len(LANGUAGES) * (len(LANGUAGES) - 1)
