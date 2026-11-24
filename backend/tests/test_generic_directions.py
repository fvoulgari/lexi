"""HTTP and PostgreSQL coverage for generic practice directions and progress."""

import os
from datetime import datetime, timezone
from uuid import UUID

import pytest
from conftest import TEST_CSRF
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.languages import card_text, direction_key
from app.models import LearningProgress, SessionCard

H = {"X-CSRF-Token": TEST_CSRF}


def collection(client, source, target, name="Directions"):
    response = client.post(
        "/api/collections",
        headers=H,
        json={"name": name, "source_language": source, "target_language": target},
    )
    assert response.status_code == 201, response.text
    return response.json()


def card(client, owner, source, target, source_text, target_text):
    response = client.post(
        f"/api/collections/{owner['id']}/cards",
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


def queue(client, account, collections, direction, mode="random"):
    response = client.post(
        "/api/sessions",
        headers=H,
        json={
            "profile_id": account["profile_id"],
            "collection_ids": [c["id"] for c in collections],
            "direction": direction,
            "mode": mode,
            "size": 10,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def position_of(session, entry_id):
    return next(c["position"] for c in session["cards"] if c["entry_id"] == entry_id)


def rate(client, session, entry_id, direction, rating):
    path = f"/api/sessions/{session['id']}/cards/{position_of(session, entry_id)}"
    revealed = client.post(path + "/reveal", headers=H, json={"direction": direction})
    assert revealed.status_code == 200, revealed.text
    response = client.post(
        path + "/reviews",
        headers=H,
        json={"direction": direction, "rating": rating},
    )
    assert response.status_code == 200, response.text
    return response.json()


def records(client, profile_id):
    return client.get(f"/api/profiles/{profile_id}/learning-records").json()


@pytest.mark.parametrize(
    "source,target,source_text,target_text",
    [
        ("en", "da", "hello", "hej"),
        ("en", "el", "hello", "γεια"),
        ("el", "it", "γεια", "ciao"),
        ("ja", "en", "日本語", "Japanese"),
        ("ar", "en", "العربية", "Arabic"),
        ("ja", "ar", "こんにちは", "مرحبا"),
    ],
)
def test_both_directions_round_trip_for_supported_pairs(
    client, account_client, source, target, source_text, target_text
):
    account = account_client(f"directions-{source}-{target}")
    c = collection(client, source, target)
    entry = card(client, c, source, target, source_text, target_text)
    expected = {source: source_text, target: target_text}

    for prompt, answer in ((source, target), (target, source)):
        direction = direction_key(prompt, answer)
        session = queue(client, account, [c], direction)
        snapshot = session["cards"][0]["snapshot"]
        assert card_text(snapshot, prompt) == expected[prompt]
        assert card_text(snapshot, answer) == expected[answer]
        event = rate(client, session, entry["id"], direction, "hard")
        assert event["direction"] == direction
        assert event["snapshot"]["id"] == entry["id"]

    keys = {r["direction"] for r in records(client, account["profile_id"])}
    assert keys == {
        direction_key(source, target),
        direction_key(target, source),
    }


def test_direction_is_validated_against_collection_and_card(client, account_client):
    account = account_client("direction-validation")
    c = collection(client, "en", "da")
    entry = card(client, c, "en", "da", "hello", "hej")

    wrong_collection = client.post(
        "/api/sessions",
        headers=H,
        json={
            "profile_id": account["profile_id"],
            "collection_ids": [c["id"]],
            "direction": "en_to_el",
        },
    )
    assert wrong_collection.status_code == 422
    assert "language pair" in wrong_collection.text

    session = queue(client, account, [c], "en_to_da")
    path = f"/api/sessions/{session['id']}/cards/{position_of(session, entry['id'])}"
    for endpoint, body in [
        (
            "/reveal",
            {"direction": "en_to_el"},
        ),
        (
            "/reviews",
            {"direction": "en_to_el", "rating": "easy"},
        ),
        (
            "/reviews",
            {"direction": "xx_to_da", "rating": "easy"},
        ),
    ]:
        response = client.post(path + endpoint, headers=H, json=body)
        assert response.status_code == 422, response.text
    assert records(client, account["profile_id"]) == []


def test_direction_switch_and_review_replay_keep_progress_separate(
    client, account_client
):
    account = account_client("direction-switch")
    c = collection(client, "en", "da")
    entry = card(client, c, "en", "da", "hello", "hej")
    forward, reverse = direction_key("en", "da"), direction_key("da", "en")

    first = queue(client, account, [c], forward)
    accepted = rate(client, first, entry["id"], forward, "again")
    path = f"/api/sessions/{first['id']}/cards/{position_of(first, entry['id'])}"
    replay = client.post(
        path + "/reviews",
        headers=H,
        json={"direction": forward, "rating": "again"},
    )
    assert replay.status_code == 200
    assert replay.json()["id"] == accepted["id"]
    conflicting = client.post(
        path + "/reviews",
        headers=H,
        json={"direction": forward, "rating": "easy"},
    )
    assert conflicting.status_code == 409

    second = queue(client, account, [c], reverse)
    rate(client, second, entry["id"], reverse, "easy")

    by_direction = {r["direction"]: r for r in records(client, account["profile_id"])}
    assert set(by_direction) == {forward, reverse}
    assert by_direction[forward]["reviews"] == 1
    assert by_direction[forward]["counts"] == {
        "again": 1,
        "hard": 0,
        "easy": 0,
    }
    assert by_direction[reverse]["reviews"] == 1
    assert by_direction[reverse]["counts"] == {
        "again": 0,
        "hard": 0,
        "easy": 1,
    }
    difficult = client.get(
        f"/api/profiles/{account['profile_id']}/difficult-entries",
        params={"direction": forward},
    ).json()
    assert [item["entry"]["id"] for item in difficult] == [entry["id"]]
    assert (
        client.get(
            f"/api/profiles/{account['profile_id']}/difficult-entries",
            params={"direction": reverse},
        ).json()
        == []
    )
    assert queue(client, account, [c], forward, mode="difficult")["available"] == 1
    assert (
        client.post(
            "/api/sessions",
            headers=H,
            json={
                "profile_id": account["profile_id"],
                "collection_ids": [c["id"]],
                "direction": reverse,
                "mode": "difficult",
            },
        ).status_code
        == 409
    )

    for direction in (forward, reverse):
        assert (
            client.patch(
                f"/api/profiles/{account['profile_id']}",
                headers=H,
                json={"preferred_direction": direction},
            ).status_code
            == 200
        )
    assert (
        client.patch(
            "/api/account",
            headers=H,
            json={"interface_language": "it"},
        ).status_code
        == 200
    )
    assert {r["direction"] for r in records(client, account["profile_id"])} == {
        forward,
        reverse,
    }


def test_shared_progress_is_per_learner_across_compatible_collections(
    client, account_client
):
    learner = account_client("shared-progress-learner")
    forward, reverse = "en", "da"
    first = collection(client, forward, reverse, "First pair")
    second = collection(client, reverse, forward, "Reversed pair")
    entry = card(client, first, forward, reverse, "hello", "hej")
    added = client.post(
        f"/api/collections/{second['id']}/entries",
        headers=H,
        json={"entry_id": entry["id"]},
    )
    assert added.status_code == 204, added.text

    direction = direction_key(reverse, forward)
    session = queue(client, learner, [first], direction)
    rate(client, session, entry["id"], direction, "again")
    difficult = queue(client, learner, [second], direction, mode="difficult")
    assert [c["entry_id"] for c in difficult["cards"]] == [entry["id"]]

    for c in (first, second):
        progress = client.get(
            f"/api/collections/{c['id']}/progress", params={"direction": direction}
        )
        assert progress.status_code == 200, progress.text
        assert progress.json() == {
            "card_count": 1,
            "practised": 1,
            "reviews": 1,
            "difficult": 1,
        }

    # A different learner's history must not leak into this learner's view.
    other = account_client("shared-progress-other")
    engine = create_engine(os.environ["DATABASE_URL"])
    with Session(engine) as db:
        db.add(
            LearningProgress(
                profile_id=UUID(other["profile_id"]),
                entry_id=UUID(entry["id"]),
                direction=direction,
                reviews=4,
                again=1,
                hard=1,
                easy=2,
                weighted_sum=1,
                weight=4,
                last_reviewed_at=datetime.now(timezone.utc),
            )
        )
        db.commit()
    engine.dispose()
    account_client("shared-progress-learner")
    for c in (first, second):
        progress = client.get(
            f"/api/collections/{c['id']}/progress", params={"direction": direction}
        )
        assert progress.json() == {
            "card_count": 1,
            "practised": 1,
            "reviews": 1,
            "difficult": 1,
        }
    assert [r["reviews"] for r in records(client, learner["profile_id"])] == [1]


@pytest.mark.parametrize("legacy_shape", ["missing", "null"])
def test_legacy_snapshots_without_language_ids_keep_their_legacy_context(
    client, account_client, legacy_shape
):
    account = account_client(f"legacy-context-{legacy_shape}")
    c = collection(client, "it", "el")
    entry = card(client, c, "it", "el", "ciao", "γεια")
    session = queue(client, account, [c], "italian_to_greek")

    engine = create_engine(os.environ["DATABASE_URL"])
    with Session(engine) as db:
        saved = db.scalar(
            select(SessionCard).where(
                SessionCard.session_id == UUID(session["id"]),
                SessionCard.position == position_of(session, entry["id"]),
            )
        )
        snapshot = dict(saved.snapshot)
        if legacy_shape == "missing":
            snapshot.pop("source_language", None)
            snapshot.pop("target_language", None)
        else:
            snapshot["source_language"] = None
            snapshot["target_language"] = None
        saved.snapshot = snapshot
        db.commit()
    engine.dispose()

    snapshot = client.get(f"/api/sessions/{session['id']}").json()["cards"][0][
        "snapshot"
    ]
    assert card_text(snapshot, "it") == "ciao"
    assert card_text(snapshot, "el") == "γεια"
    path = f"/api/sessions/{session['id']}/cards/0"
    assert (
        client.post(
            path + "/reveal", headers=H, json={"direction": "en_to_da"}
        ).status_code
        == 422
    )
    event = rate(client, session, entry["id"], "italian_to_greek", "easy")
    assert event["direction"] == "italian_to_greek"
    assert card_text(event["snapshot"], "it") == "ciao"
    assert card_text(event["snapshot"], "el") == "γεια"
    assert [r["direction"] for r in records(client, account["profile_id"])] == [
        "italian_to_greek"
    ]
