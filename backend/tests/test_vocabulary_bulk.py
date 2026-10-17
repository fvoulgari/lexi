from uuid import uuid4

from test_practice import headers, start


def cards(client):
    return client.get("/api/vocabulary?page_size=100").json()["items"]


def bulk(client, action, ids, **extra):
    return client.post(
        "/api/vocabulary/bulk",
        json={"action": action, "entry_ids": ids, **extra},
        headers=headers(client),
    )


def test_selection_matches_search_unit_and_type_filters(logged_in):
    client = logged_in
    for params in (
        {},
        {"q": "casa"},
        {"word_types": ["noun"]},
        {"q": "%"},
        {"unit_ids": [client.get("/api/units").json()[1]["id"]]},
    ):
        page = client.get("/api/vocabulary", params={**params, "page_size": 100}).json()
        selection = client.get("/api/vocabulary/selection", params=params).json()
        assert set(selection["entry_ids"]) == {card["id"] for card in page["items"]}


def test_move_preserves_review_history_and_other_card_fields(logged_in):
    client = logged_in
    session = start(client).json()
    path = f"/api/sessions/{session['id']}/cards/0"
    client.post(
        path + "/reveal",
        json={"direction": "greek_to_italian"},
        headers=headers(client),
    )
    client.post(
        path + "/reviews",
        json={"direction": "greek_to_italian", "rating": "hard"},
        headers=headers(client),
    )
    profile = session["profile_id"]
    before = client.get(f"/api/profiles/{profile}/progress").json()
    original = {card["id"]: card for card in cards(client)}
    target = client.get("/api/units").json()[1]["id"]
    ids = list(original)
    result = bulk(client, "move", ids, unit_id=target)
    assert result.status_code == 200
    assert result.json() == {"action": "move", "count": len(ids)}
    for card in cards(client):
        assert card["unit"]["id"] == target
        for key, value in original[card["id"]].items():
            if key not in ("unit", "updated_at"):
                assert card[key] == value
    assert client.get(f"/api/profiles/{profile}/progress").json() == before
    assert (
        client.get(f"/api/sessions/{session['id']}").json()["cards"][0]["snapshot"]
        == session["cards"][0]["snapshot"]
    )


def test_delete_is_atomic_and_reviewed_cards_can_be_excluded(logged_in):
    client = logged_in
    session = start(client).json()
    reviewed = session["cards"][0]["entry_id"]
    other = session["cards"][1]["entry_id"]
    path = f"/api/sessions/{session['id']}/cards/0"
    client.post(
        path + "/reveal",
        json={"direction": "greek_to_italian"},
        headers=headers(client),
    )
    accepted = client.post(
        path + "/reviews",
        json={"direction": "greek_to_italian", "rating": "hard"},
        headers=headers(client),
    ).json()
    total = len(cards(client))
    missing = str(uuid4())
    response = bulk(client, "delete", [reviewed, other, missing])
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "bulk_blocked"
    assert set(response.json()["error"]["entry_ids"]) == {reviewed, missing}
    assert len(cards(client)) == total
    response = bulk(client, "delete", [other, other])
    assert response.json() == {"action": "delete", "count": 1}
    assert len(cards(client)) == total - 1
    assert client.get(f"/api/vocabulary/{reviewed}").status_code == 200
    assert client.get(f"/api/vocabulary/{other}").status_code == 404
    assert (
        client.post(
            path + "/reviews",
            json={"direction": "greek_to_italian", "rating": "hard"},
            headers=headers(client),
        ).json()
        == accepted
    )
    assert (
        client.get(f"/api/sessions/{session['id']}").json()["cards"][1]["skipped"]
        is True
    )


def test_invalid_or_missing_targets_never_partially_write(logged_in):
    client = logged_in
    original = cards(client)
    ids = [original[0]["id"], str(uuid4())]
    target = client.get("/api/units").json()[1]["id"]
    for action, extra in [("delete", {}), ("move", {"unit_id": target})]:
        assert bulk(client, action, ids, **extra).status_code == 409
    assert (
        bulk(client, "move", [original[0]["id"]], unit_id=str(uuid4())).status_code
        == 422
    )
    assert bulk(client, "move", [original[0]["id"]]).status_code == 422
    assert bulk(client, "delete", []).status_code == 422
    assert (
        bulk(client, "delete", [original[0]["id"]], unit_id=target).status_code == 422
    )
    assert cards(client) == original


def test_bulk_operations_require_gate_and_csrf(logged_in):
    client = logged_in
    ids = [cards(client)[0]["id"]]
    body = {"action": "delete", "entry_ids": ids}
    assert client.post("/api/vocabulary/bulk", json=body).status_code == 403
    client.cookies.clear()
    assert client.get("/api/vocabulary/selection").status_code == 401
    assert (
        client.post(
            "/api/vocabulary/bulk", json=body, headers=headers(client)
        ).status_code
        == 401
    )
