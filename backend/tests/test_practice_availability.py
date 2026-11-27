"""Permission-aware practice pair discovery and additive grammar snapshots."""

import os
from uuid import UUID

from conftest import TEST_CSRF
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.models import SessionCard

H = {"X-CSRF-Token": TEST_CSRF}


def collection(client, source, target, name, public=False):
    response = client.post(
        "/api/collections",
        headers=H,
        json={
            "name": name,
            "source_language": source,
            "target_language": target,
            "make_public": public,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def card(client, collection_id, source_text, target_text, **body):
    payload = {
        "source_text": source_text,
        "target_text": target_text,
        "word_type": "expression",
        **body,
    }
    if collection_id is None:
        response = client.post("/api/vocabulary", headers=H, json=payload)
    else:
        payload.setdefault("confirm_exposure", True)
        response = client.post(
            f"/api/collections/{collection_id}/cards", headers=H, json=payload
        )
    assert response.status_code == 201, response.text
    return response.json()


def pair_map(client):
    response = client.get("/api/practice/available-pairs")
    assert response.status_code == 200, response.text
    return {row["key"]: row for row in response.json()["pairs"]}


def test_available_pairs_are_permission_scoped_and_deduplicated(
    client, logged_in, account_client
):
    assert logged_in.get("/api/practice/available-pairs").status_code == 200

    own = collection(logged_in, "en", "da", "Own Danish")
    card(logged_in, own["id"], "house", "hus")
    card(logged_in, own["id"], "book", "bog")

    reversed_orientation = collection(logged_in, "da", "en", "Reversed Danish")
    card(logged_in, reversed_orientation["id"], "hus", "house")
    collection(logged_in, "ja", "en", "Empty Japanese")

    pairs = pair_map(logged_in)
    assert pairs["da-en"]["languages"] == ["da", "en"]
    assert pairs["da-en"]["directions"] == ["da_to_en", "en_to_da"]
    assert pairs["da-en"]["card_count"] == 3
    assert "ja-en" not in pairs

    shared = collection(logged_in, "fr", "de", "Shared French", public=True)
    card(logged_in, shared["id"], "maison", "Haus")

    account_client("test-learner")
    learner_pairs = pair_map(client)
    assert learner_pairs["de-fr"]["card_count"] == 1
    assert "da-en" not in learner_pairs

    # A saved public collection stays discoverable only while access is valid.
    assert (
        client.put(f"/api/collections/{shared['id']}/saved", headers=H).status_code
        == 204
    )
    assert pair_map(client)["de-fr"]["card_count"] == 1

    # Unpublishing removes the grant; a previously visible pair disappears.
    account_client("test-admin")
    logged_in.post(
        f"/api/collections/{shared['id']}/unpublish", headers=H, json={}
    )
    account_client("test-learner")
    assert "de-fr" not in pair_map(client)


def test_archived_cards_are_excluded_from_saved_pair_availability(
    client, logged_in, account_client
):
    shared = collection(logged_in, "fr", "de", "Saved French", public=True)
    visible = card(logged_in, shared["id"], "maison", "Haus")
    archived = card(logged_in, shared["id"], "livre", "Buch")

    account_client("test-learner")
    assert (
        client.put(f"/api/collections/{shared['id']}/saved", headers=H).status_code
        == 204
    )
    assert pair_map(client)["de-fr"]["card_count"] == 2

    account_client("test-admin")
    assert (
        client.delete(f"/api/vocabulary/{archived['id']}", headers=H).status_code
        == 200
    )
    account_client("test-learner")
    assert pair_map(client)["de-fr"]["card_count"] == 1
    assert visible["id"] != archived["id"]

    account_client("test-admin")
    assert (
        client.post(
            f"/api/collections/{shared['id']}/unpublish", headers=H, json={}
        ).status_code
        == 200
    )
    account_client("test-learner")
    assert "de-fr" not in pair_map(client)


def test_new_snapshot_keeps_structured_grammar_alongside_flat_fields(logged_in):
    group = collection(logged_in, "en", "da", "Snapshots")
    card(
        logged_in,
        group["id"],
        "house",
        "hus",
        word_type="noun",
        source_language="en",
        target_language="da",
        grammar={"da": {"gender": "common", "plural": "huse"}},
    )
    profile = logged_in.get("/api/profiles").json()[0]

    response = logged_in.post(
        "/api/sessions",
        headers=H,
        json={
            "profile_id": profile["id"],
            "direction": "en_to_da",
            "size": 10,
        },
    )
    assert response.status_code == 201, response.text
    snapshot = response.json()["cards"][0]["snapshot"]
    assert snapshot["source_language"] == "en"
    assert snapshot["target_language"] == "da"
    assert snapshot["italian"] == "house"
    assert snapshot["greek"] == "hus"
    assert snapshot["grammar"]["da"] == {"gender": "common", "plural": "huse"}


def test_structured_grammar_survives_active_review_summary_and_progress(logged_in):
    group = collection(logged_in, "en", "da", "Grammar in history")
    word = card(
        logged_in,
        group["id"],
        "house",
        "hus",
        word_type="noun",
        source_language="en",
        target_language="da",
        grammar={"da": {"gender": "common", "plural": "huse"}},
    )
    profile = logged_in.get("/api/profiles").json()[0]

    response = logged_in.post(
        "/api/sessions",
        headers=H,
        json={
            "profile_id": profile["id"],
            "direction": "en_to_da",
            "size": 25,
        },
    )
    assert response.status_code == 201, response.text
    session = response.json()
    position = next(
        item["position"] for item in session["cards"] if item["entry_id"] == word["id"]
    )
    path = f"/api/sessions/{session['id']}/cards/{position}"
    assert (
        logged_in.post(
            path + "/reveal", headers=H, json={"direction": "en_to_da"}
        ).status_code
        == 200
    )
    assert (
        logged_in.post(
            path + "/reviews",
            headers=H,
            json={"direction": "en_to_da", "rating": "again"},
        ).status_code
        == 200
    )

    summary = logged_in.get(f"/api/sessions/{session['id']}/summary").json()
    review = next(
        row for row in summary["needs_practice"] if row["entry_id"] == word["id"]
    )
    assert review["direction"] == "en_to_da"
    assert review["snapshot"]["grammar"]["da"] == {
        "gender": "common",
        "plural": "huse",
    }
    progress = logged_in.get(f"/api/profiles/{profile['id']}/progress").json()
    assert any(row["key"] == "en_to_da" for row in progress["directions"])


def test_historical_snapshot_without_grammar_is_still_readable(logged_in):
    group = collection(logged_in, "en", "da", "Historical snapshot")
    card(logged_in, group["id"], "house", "hus", word_type="expression")
    profile = logged_in.get("/api/profiles").json()[0]
    session_response = logged_in.post(
        "/api/sessions",
        headers=H,
        json={"profile_id": profile["id"], "direction": "en_to_da", "size": 10},
    )
    assert session_response.status_code == 201, session_response.text
    session = session_response.json()

    engine = create_engine(os.environ["DATABASE_URL"])
    with Session(engine) as db:
        saved = db.scalar(
            select(SessionCard).where(
                SessionCard.session_id == UUID(session["id"]),
                SessionCard.position == 0,
            )
        )
        snapshot = dict(saved.snapshot)
        snapshot.pop("grammar", None)
        saved.snapshot = snapshot
        db.commit()
    engine.dispose()

    response = logged_in.get(f"/api/sessions/{session['id']}")
    assert response.status_code == 200, response.text
    snapshot = response.json()["cards"][0]["snapshot"]
    assert "grammar" not in snapshot
    assert snapshot["greek"] == "hus"
