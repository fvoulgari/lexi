"""Unit assignment and each learner's explicit practice scope."""

from uuid import uuid4

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.exc import IntegrityError


def headers(client):
    return {"X-CSRF-Token": client.get("/api/auth/session").json()["csrf_token"]}


def update(client, profile, units):
    response = client.patch(
        f"/api/profiles/{profile}",
        json={"practice_unit_ids": units},
        headers=headers(client),
    )
    assert response.status_code == 200
    return response.json()


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
    body = {"italian": "nuovo", "greek": "νέο", "word_type": "adjective"}
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


@pytest.mark.parametrize("mode", ["random", "category", "mixed", "difficult"])
def test_every_mode_and_fallback_stays_in_selected_units(logged_in, mode):
    client = logged_in
    profile = client.get("/api/profiles").json()[0]["id"]
    units = client.get("/api/units").json()
    cards = client.get("/api/vocabulary?page_size=100").json()["items"]
    unit = cards[0]["unit"]["id"]
    allowed = {c["id"] for c in cards if c["unit"]["id"] == unit}
    update(client, profile, [u["id"] for u in units])
    session = start(client, profile).json()
    path = f"/api/sessions/{session['id']}"
    for card in session["cards"]:
        url = f"{path}/cards/{card['position']}"
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
    update(client, profile, [unit])
    result = start(client, profile, mode)
    assert result.status_code == 201
    assert {c["entry_id"] for c in result.json()["cards"]} == allowed
    excluded = next(u["id"] for u in units if u["id"] != unit)
    assert start(client, profile, mode, unit_ids=[excluded]).status_code == 409
    difficult = client.get(
        f"/api/profiles/{profile}/difficult-entries?direction=greek_to_italian"
    ).json()
    assert len(difficult) == len(allowed)
    progress = client.get(f"/api/profiles/{profile}/progress").json()
    assert progress["practice_available"] == len(allowed)
    assert progress["practice_difficult_entries"] == len(allowed)
    assert progress["total_reviews"] == len(cards)
    assert progress["difficult_entries"] == len(cards)
    update(client, profile, [])
    for candidate in ("random", "category", "mixed", "difficult"):
        empty = start(client, profile, candidate)
        assert empty.status_code == 409
        assert empty.json()["error"]["code"] == "no_practice_units"
    after = client.get(f"/api/profiles/{profile}/progress").json()
    for key in ("total_reviews", "entries_practised", "difficult_entries", "units"):
        assert after[key] == progress[key]
    assert after["practice_available"] == after["practice_difficult_entries"] == 0


def test_mixed_shortage_fills_from_selected_units_only(logged_in):
    client = logged_in
    profile = client.get("/api/profiles").json()[0]["id"]
    unit = client.get("/api/units").json()[0]["id"]
    update(client, profile, [unit])
    result = start(client, profile, "mixed").json()
    assert result["available"] > 0
    assert all(c["snapshot"]["unit"]["id"] == unit for c in result["cards"])
    assert len({c["entry_id"] for c in result["cards"]}) == len(result["cards"])


def test_new_units_and_new_profiles_require_explicit_opt_in(logged_in, test_database):
    client = logged_in
    profiles = client.get("/api/profiles").json()
    before = {p["id"]: p["practice_unit_ids"] for p in profiles}
    unit = client.post(
        "/api/units",
        json={"code": "NEW", "title": "New shared unit", "sort_order": 0},
        headers=headers(client),
    ).json()
    assert {
        p["id"]: p["practice_unit_ids"] for p in client.get("/api/profiles").json()
    } == before
    new = client.post(
        "/api/profiles", json={"display_name": "New learner"}, headers=headers(client)
    ).json()
    assert new["practice_unit_ids"] == []
    assert start(client, new["id"]).status_code == 409
    url = f"/api/profiles/{new['id']}/practice-units/{unit['id']}"
    for _ in range(2):
        assert client.put(url, headers=headers(client)).json()["practice_unit_ids"] == [
            unit["id"]
        ]
    assert start(client, new["id"]).json()["error"]["code"] == "no_matches"
    assert (
        client.patch(
            f"/api/profiles/{new['id']}",
            json={"practice_unit_ids": [str(uuid4())]},
            headers=headers(client),
        ).status_code
        == 422
    )
    engine = create_engine(test_database)
    with pytest.raises(IntegrityError), engine.begin() as connection:
        connection.execute(text("DELETE FROM units WHERE id = :id"), {"id": unit["id"]})
    engine.dispose()
