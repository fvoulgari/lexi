"""Required card units and freely chosen session filters."""

from uuid import uuid4

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.exc import IntegrityError


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


def test_required_units_for_manual_cards_and_csv(logged_in):
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
                "/api/vocabulary", json={**body, **unit}, headers=headers(client)
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
def test_session_unit_choices_apply_without_profile_assignment(logged_in, mode):
    client = logged_in
    profile = client.get("/api/profiles").json()[0]["id"]
    other_unit = client.get("/api/units").json()[1]["id"]
    assert (
        client.post(
            "/api/vocabulary",
            json={
                "italian_adjective_gender": "masculine",
                "greek_adjective_gender": "masculine",
                "italian": "nuovo",
                "greek": "νέο",
                "word_type": "adjective",
                "unit_id": other_unit,
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
    for unit in client.get("/api/units").json():
        allowed = {c["id"] for c in cards if c["unit"]["id"] == unit["id"]}
        result = start(client, profile, mode, unit_ids=[unit["id"]])
        assert result.status_code == 201
        assert {c["entry_id"] for c in result.json()["cards"]} == allowed
    assert len(start(client, profile, mode).json()["cards"]) == len(cards)
    assert client.get(f"/api/profiles/{profile}/progress").json()[
        "total_reviews"
    ] == len(cards)


def test_new_profile_can_practise_new_unit_immediately(logged_in, test_database):
    client = logged_in
    unit = client.post(
        "/api/units",
        json={"code": "NEW", "title": "New shared unit", "sort_order": 0},
        headers=headers(client),
    ).json()
    card = client.post(
        "/api/vocabulary",
        json={
            "italian_adjective_gender": "masculine",
            "greek_adjective_gender": "masculine",
            "italian": "nuovo",
            "greek": "νέο",
            "word_type": "adjective",
            "unit_id": unit["id"],
        },
        headers=headers(client),
    ).json()["entry"]
    profile = client.post(
        "/api/profiles", json={"display_name": "New learner"}, headers=headers(client)
    ).json()
    assert "practice_unit_ids" not in profile
    session = start(client, profile["id"], "mixed", unit_ids=[unit["id"]]).json()
    assert [c["entry_id"] for c in session["cards"]] == [card["id"]]
    engine = create_engine(test_database)
    with pytest.raises(IntegrityError), engine.begin() as connection:
        connection.execute(text("DELETE FROM units WHERE id = :id"), {"id": unit["id"]})
    engine.dispose()
