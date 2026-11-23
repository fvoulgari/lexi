"""Collection pairs are explicit, unordered and fixed once cards reference them."""

import os
from uuid import UUID, uuid4

import pytest
from conftest import TEST_CSRF, signin
from sqlalchemy import create_engine, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.languages import card_text
from app.models import CollectionEntry, VocabularyEntry

H = {"X-CSRF-Token": TEST_CSRF}


def make_collection(client, a, b, name="Pair"):
    response = client.post(
        "/api/collections",
        headers=H,
        json={"name": name, "source_language": a, "target_language": b},
    )
    assert response.status_code == 201, response.text
    return response.json()


def make_card(client, collection, source, target, source_text, target_text):
    response = client.post(
        f"/api/collections/{collection['id']}/cards",
        headers=H,
        json={
            "source_language": source,
            "target_language": target,
            "source_text": source_text,
            "target_text": target_text,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def add_card(client, collection, card):
    return client.post(
        f"/api/collections/{collection['id']}/entries",
        headers=H,
        json={"entry_id": card["id"]},
    )


def pair_of(collection):
    return collection["source_language"], collection["target_language"]


def test_create_requires_two_different_supported_languages(client, account_client):
    account_client("pair-create")
    for source, target in (("en", "en"), ("xx", "el"), ("el", "xx")):
        response = client.post(
            "/api/collections",
            headers=H,
            json={
                "name": "Invalid",
                "source_language": source,
                "target_language": target,
            },
        )
        assert response.status_code == 422, response.text
        assert "two different supported languages" in response.text

    assert pair_of(make_collection(client, "da", "en")) == ("da", "en")
    assert pair_of(make_collection(client, "en", "da", "Reversed")) == ("da", "en")


def test_reversed_pair_card_is_reused_across_collections(client, account_client):
    account_client("pair-reuse")
    first = make_collection(client, "en", "da", "First")
    reversed_pair = make_collection(client, "da", "en", "Reversed")
    third = make_collection(client, "en", "da", "Third")
    incompatible = make_collection(client, "el", "it", "Other pair")

    italian, danish = unique("hello"), unique("hej")
    # The card's stored order is the reverse of its collections' canonical pair.
    card = make_card(client, first, "en", "da", italian, danish)
    assert (card["source_language"], card["target_language"]) == ("en", "da")
    assert add_card(client, reversed_pair, card).status_code == 204
    assert add_card(client, third, card).status_code == 204
    assert add_card(client, incompatible, card).status_code == 422

    for collection in (first, reversed_pair, third):
        entries = client.get(f"/api/collections/{collection['id']}/entries").json()
        assert [entry["id"] for entry in entries] == [card["id"]]
        assert card_text(entries[0], "en") == italian
        assert card_text(entries[0], "da") == danish
        found = client.get(
            f"/api/collections/{collection['id']}/search", params={"q": italian}
        ).json()
        assert [entry["id"] for entry in found] == [card["id"]]

    with client.app.state.sessions() as db:
        assert db.scalars(
            select(VocabularyEntry.id).where(VocabularyEntry.italian == italian)
        ).all() == [UUID(card["id"])]
        memberships = db.execute(
            select(
                CollectionEntry.collection_id,
                CollectionEntry.entry_id,
                CollectionEntry.position,
            )
            .where(CollectionEntry.entry_id == UUID(card["id"]))
            .order_by(CollectionEntry.collection_id)
        ).all()
        assert len(memberships) == 3
        assert {row[0] for row in memberships} == {
            UUID(c["id"]) for c in (first, reversed_pair, third)
        }
        assert {row[1] for row in memberships} == {UUID(card["id"])}
        assert {row[2] for row in memberships} == {0}


def test_wrong_pair_add_fails_in_api_and_database(client, account_client):
    account_client("wrong-pair")
    matching = make_collection(client, "en", "da", "Matching")
    other = make_collection(client, "el", "it", "Other")
    card = make_card(client, matching, "en", "da", unique("hello"), unique("hej"))

    response = add_card(client, other, card)
    assert response.status_code == 422, response.text
    assert "differs from collection pair" in response.text
    assert "same language pair" in response.text

    bulk = client.post(
        "/api/vocabulary/bulk",
        headers=H,
        json={
            "action": "add_to_collection",
            "collection_id": other["id"],
            "entry_ids": [card["id"]],
        },
    )
    assert bulk.status_code == 422, bulk.text

    engine = create_engine(os.environ["DATABASE_URL"])
    with Session(engine) as db:
        with pytest.raises(
            IntegrityError, match="Card language pair differs from collection"
        ):
            with db.begin_nested():
                db.execute(
                    text(
                        "INSERT INTO collection_entries "
                        "(collection_id, entry_id, position) "
                        "VALUES (:collection, :entry, 0)"
                    ),
                    {"collection": other["id"], "entry": card["id"]},
                )
    engine.dispose()
    assert client.get(f"/api/collections/{other['id']}/entries").json() == []


def test_populated_pair_change_fails_in_api_and_database(client, account_client):
    account_client("populated-change")
    collection = make_collection(client, "en", "da", "Populated")
    card = make_card(client, collection, "en", "da", unique("hello"), unique("hej"))
    assert pair_of(collection) == ("da", "en")

    change = {
        "name": "Populated",
        "source_language": "it",
        "target_language": "el",
    }
    response = client.patch(
        f"/api/collections/{collection['id']}", headers=H, json=change
    )
    assert response.status_code == 422, response.text
    assert "Remove every card" in response.text

    engine = create_engine(os.environ["DATABASE_URL"])
    with Session(engine) as db:
        with pytest.raises(IntegrityError, match="Remove every card"):
            with db.begin_nested():
                db.execute(
                    text(
                        "UPDATE collections SET source_language='el', "
                        "target_language='it' WHERE id=:id"
                    ),
                    {"id": collection["id"]},
                )
        stored = db.execute(
            text(
                "SELECT source_language, target_language FROM collections WHERE id=:id"
            ),
            {"id": collection["id"]},
        ).one()
    engine.dispose()
    assert stored == ("da", "en")

    # Renaming and a reversed restatement of the same pair remain valid.
    renamed = client.patch(
        f"/api/collections/{collection['id']}",
        headers=H,
        json={
            **change,
            "source_language": "da",
            "target_language": "en",
            "name": "New",
        },
    )
    assert renamed.status_code == 200, renamed.text
    assert pair_of(renamed.json()) == ("da", "en")
    assert [
        entry["id"]
        for entry in client.get(f"/api/collections/{collection['id']}/entries").json()
    ] == [card["id"]]


def test_empty_pair_change_succeeds_and_applies_to_new_cards(client, account_client):
    account_client("empty-change")
    collection = make_collection(client, "en", "da", "Empty")
    old_pair_source = make_collection(client, "en", "da", "Old pair source")
    old_card = make_card(
        client, old_pair_source, "en", "da", unique("hello"), unique("hej")
    )

    changed = client.patch(
        f"/api/collections/{collection['id']}",
        headers=H,
        json={"name": "Empty", "source_language": "it", "target_language": "el"},
    )
    assert changed.status_code == 200, changed.text
    assert pair_of(changed.json()) == ("el", "it")
    assert add_card(client, collection, old_card).status_code == 422

    italian, greek = unique("ciao"), unique("γεια")
    card = make_card(client, changed.json(), "it", "el", italian, greek)
    assert add_card(client, changed.json(), card).status_code == 204
    entries = client.get(f"/api/collections/{collection['id']}/entries").json()
    assert card_text(entries[0], "it") == italian
    assert card_text(entries[0], "el") == greek

    # A reversed restatement of the stored pair is not a change, even when filled.
    unchanged = client.patch(
        f"/api/collections/{collection['id']}",
        headers=H,
        json={"name": "Empty", "source_language": "el", "target_language": "it"},
    )
    assert unchanged.status_code == 200, unchanged.text
    assert pair_of(unchanged.json()) == ("el", "it")


def test_existing_italian_greek_collection_keeps_its_id_and_cards(client):
    signin(client)
    collection = next(
        c for c in client.get("/api/collections").json() if pair_of(c) == ("el", "it")
    )
    entries_path = f"/api/collections/{collection['id']}/entries"
    before = {entry["id"] for entry in client.get(entries_path).json()}
    italian, greek = unique("ciao"), unique("γεια")
    card = make_card(client, collection, "it", "el", italian, greek)
    response = client.patch(
        f"/api/collections/{collection['id']}",
        headers=H,
        json={
            "name": collection["name"],
            "source_language": "en",
            "target_language": "da",
        },
    )
    assert response.status_code == 422, response.text
    listing = client.get("/api/collections").json()
    assert any(
        c["id"] == collection["id"] and pair_of(c) == ("el", "it") for c in listing
    )
    after = {entry["id"] for entry in client.get(entries_path).json()}
    assert after == before | {card["id"]}


def unique(label):
    return f"{label}-{uuid4().hex}"
