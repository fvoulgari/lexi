"""Collection destinations and independently chosen session filters."""

from uuid import uuid4

import pytest


def headers(client):
    return {"X-CSRF-Token": client.get("/api/auth/session").json()["csrf_token"]}


def start(client, profile, mode="random", **extra):
    return client.post(
        "/api/sessions",
        json={
            "profile_id": profile,
            "direction": "greek_to_italian",
            "size": None,
            "mode": "random" if mode == "category" else mode,
            **extra,
        },
        headers=headers(client),
    )


def test_legacy_unit_filter_includes_cards_in_mapped_collection(client, account_client):
    from uuid import UUID

    from app.models import Collection

    account = account_client("mapped-practice-owner")
    old_unit = uuid4()
    collection = client.post(
        "/api/collections", headers=headers(client), json={"name": "Mapped"}
    ).json()
    with client.app.state.sessions.begin() as db:
        db.get(Collection, UUID(collection["id"])).source_unit_id = old_unit
    created = client.post(
        "/api/vocabulary",
        headers=headers(client),
        json={
            "collection_id": collection["id"],
            "italian": "ciao",
            "greek": "γεια",
            "word_type": "expression",
        },
    ).json()["entry"]
    result = start(client, account["profile_id"], unit_ids=[str(old_unit)])
    assert result.status_code == 201, result.text
    assert {card["entry_id"] for card in result.json()["cards"]} == {created["id"]}


def test_legacy_unit_filter_does_not_expose_private_collection_membership(
    client, account_client
):
    from uuid import UUID

    from test_shareable_collections import add, collection, publish

    from app.models import Collection

    account_client("private-map-owner")
    private = collection(client, "Private")
    public = collection(client, "Public")
    old_unit = uuid4()
    with client.app.state.sessions.begin() as db:
        db.get(Collection, UUID(private["id"])).source_unit_id = old_unit
    entry = client.post(
        "/api/vocabulary",
        headers=headers(client),
        json={
            "collection_id": private["id"],
            "italian": "ciao",
            "greek": "γεια",
            "word_type": "expression",
        },
    ).json()["entry"]
    assert add(client, public, entry).status_code == 204
    assert publish(client, public).status_code == 200
    other = account_client("private-map-reader")
    assert client.get("/api/vocabulary").json()["total"] == 1
    filtered = client.get(f"/api/vocabulary?unit_ids={old_unit}").json()
    assert filtered["total"] == 0
    assert (
        start(client, other["profile_id"], unit_ids=[str(old_unit)]).status_code == 409
    )


def test_required_collections_for_manual_cards_and_csv(logged_in):
    client = logged_in
    body = {
        "italian_adjective_gender": "masculine",
        "greek_adjective_gender": "masculine",
        "italian": "nuovo",
        "greek": "νέο",
        "word_type": "adjective",
    }
    for unit in ({}, {"unit_id": None}, {"unit_id": str(uuid4())}):
        assert (
            client.post(
                "/api/vocabulary",
                json={"visibility": "private", **body, **unit},
                headers=headers(client),
            ).status_code
            == 422
        )
    csv = "italian,greek,word_type\nnuovo,νέο,adjective\n".encode()
    for action in ("preview", "confirm"):
        for query in ("", f"?unit_id={uuid4()}"):
            assert (
                client.post(
                    f"/api/imports/{action}{query}",
                    content=csv,
                    headers=headers(client),
                ).status_code
                == 422
            )
    card = client.get("/api/vocabulary?page_size=100").json()["items"][0]
    assert (
        client.patch(
            f"/api/vocabulary/{card['id']}",
            json={"unit_id": None},
            headers=headers(client),
        ).status_code
        == 422
    )


@pytest.mark.parametrize("mode", ["random", "mixed", "difficult"])
def test_session_collection_choices_apply_without_profile_assignment(logged_in, mode):
    client = logged_in
    profile = client.get("/api/profiles").json()[0]["id"]
    other_unit = client.get("/api/collections").json()[1]["id"]
    assert (
        client.post(
            "/api/vocabulary",
            json={
                "visibility": "private",
                "italian_adjective_gender": "masculine",
                "greek_adjective_gender": "masculine",
                "italian": "nuovo",
                "greek": "νέο",
                "word_type": "adjective",
                "collection_id": other_unit,
            },
            headers=headers(client),
        ).status_code
        == 201
    )
    cards = client.get("/api/vocabulary?page_size=100").json()["items"]
    session = start(client, profile).json()
    for card in session["cards"]:
        url = f"/api/sessions/{session['id']}/cards/{card['position']}"
        assert (
            client.post(
                url + "/reveal",
                json={"direction": "greek_to_italian"},
                headers=headers(client),
            ).status_code
            == 200
        )
        assert (
            client.post(
                url + "/reviews",
                json={"direction": "greek_to_italian", "rating": "hard"},
                headers=headers(client),
            ).status_code
            == 200
        )
    for unit in client.get("/api/collections").json():
        allowed = set(unit["entry_ids"])
        result = start(client, profile, mode, collection_ids=[unit["id"]])
        assert result.status_code == 201
        assert {c["entry_id"] for c in result.json()["cards"]} == allowed
    assert len(start(client, profile, mode).json()["cards"]) == len(cards)
    assert client.get(f"/api/profiles/{profile}/progress").json()[
        "total_reviews"
    ] == len(cards)


def test_new_profile_can_practise_new_collection_immediately(logged_in):
    client = logged_in
    unit = client.post(
        "/api/collections",
        json={"name": "New Collection"},
        headers=headers(client),
    ).json()
    card = client.post(
        "/api/vocabulary",
        json={
            "visibility": "private",
            "italian_adjective_gender": "masculine",
            "greek_adjective_gender": "masculine",
            "italian": "nuovo",
            "greek": "νέο",
            "word_type": "adjective",
            "collection_id": unit["id"],
        },
        headers=headers(client),
    ).json()["entry"]
    profile = client.get("/api/profiles").json()[0]
    assert "practice_unit_ids" not in profile
    session = start(client, profile["id"], "mixed", collection_ids=[unit["id"]]).json()
    assert [c["entry_id"] for c in session["cards"]] == [card["id"]]
    assert (
        client.delete(
            f"/api/collections/{unit['id']}", headers=headers(client)
        ).status_code
        == 204
    )
    assert client.get(f"/api/vocabulary/{card['id']}").status_code == 200
