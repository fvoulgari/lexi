import pytest
from test_practice import headers, start


def test_difficult_entries_follow_review_history_and_direction(logged_in):
    client = logged_in
    initial = start(client, size=None).json()
    profile = initial["profile_id"]
    entry = initial["cards"][0]["entry_id"]
    path = f"/api/profiles/{profile}/difficult-entries"
    assert client.get(path, params={"direction": "greek_to_italian"}).json() == []
    for rating, expected in [
        ("again", 1),
        ("easy", 0.4444444444),
        ("hard", 0.4672131148),
        ("again", 0.647696477),
    ]:
        session = start(client, profile=profile, size=None).json()
        position = next(
            c["position"] for c in session["cards"] if c["entry_id"] == entry
        )
        card_path = f"/api/sessions/{session['id']}/cards/{position}"
        client.post(
            card_path + "/reveal",
            json={"direction": "greek_to_italian"},
            headers=headers(client),
        )
        client.post(
            card_path + "/reviews",
            json={"direction": "greek_to_italian", "rating": rating},
            headers=headers(client),
        )
        record = client.get(f"/api/profiles/{profile}/learning-records").json()[0]
        assert record["difficulty"] == pytest.approx(expected)
        items = client.get(path, params={"direction": "greek_to_italian"}).json()
        assert len(items) == (1 if expected >= 0.5 else 0)
    assert items[0]["entry"]["id"] == entry
    assert client.get(path, params={"direction": "italian_to_greek"}).json() == []
    other = next(
        p["id"] for p in client.get("/api/profiles").json() if p["id"] != profile
    )
    assert (
        client.get(
            f"/api/profiles/{other}/difficult-entries",
            params={"direction": "greek_to_italian"},
        ).json()
        == []
    )
    response = client.post(
        "/api/sessions",
        json={
            "profile_id": profile,
            "direction": "greek_to_italian",
            "size": 25,
            "mode": "difficult",
        },
        headers=headers(client),
    )
    assert response.status_code == 201
    assert response.json()["available"] == 1
    assert [c["entry_id"] for c in response.json()["cards"]] == [entry]
    assert (
        client.post(
            "/api/sessions",
            json={
                "profile_id": profile,
                "direction": "italian_to_greek",
                "mode": "difficult",
            },
            headers=headers(client),
        ).status_code
        == 409
    )
    assert client.get(path, params={"direction": "invalid"}).status_code == 422
    client.cookies.clear()
    assert client.get(path, params={"direction": "greek_to_italian"}).status_code == 401


def test_hard_cutoff_inactivity_and_difficult_review_summary(logged_in, monkeypatch):
    from datetime import datetime, timedelta

    import app.auth

    client = logged_in
    session = start(client, size=None).json()
    profile = session["profile_id"]
    direction = "greek_to_italian"
    card_path = f"/api/sessions/{session['id']}/cards/0"
    client.post(
        card_path + "/reveal", json={"direction": direction}, headers=headers(client)
    )
    client.post(
        card_path + "/reviews",
        json={"direction": direction, "rating": "hard"},
        headers=headers(client),
    )
    path = f"/api/profiles/{profile}/difficult-entries?direction={direction}"
    before = client.get(path).json()
    assert before[0]["difficulty"] == 0.5

    class Later(datetime):
        @classmethod
        def now(cls, tz=None):
            return datetime.now(tz) + timedelta(days=365)

    monkeypatch.setattr(app.auth, "datetime", Later)
    client.cookies.clear()
    assert (
        client.post(
            "/api/auth/login",
            json={"password": "test-notebook-password"},
            headers=headers(client),
        ).status_code
        == 200
    )
    assert client.get(path).json() == before
    practice = client.post(
        "/api/sessions",
        json={
            "profile_id": profile,
            "direction": direction,
            "size": None,
            "mode": "difficult",
        },
        headers=headers(client),
    ).json()
    assert len(practice["cards"]) == 1
    assert practice["cards"][0]["entry_id"] == before[0]["entry"]["id"]
    card_path = f"/api/sessions/{practice['id']}/cards/0"
    client.post(
        card_path + "/reveal", json={"direction": direction}, headers=headers(client)
    )
    response = client.post(
        card_path + "/reviews",
        json={"direction": direction, "rating": "again"},
        headers=headers(client),
    )
    assert response.status_code == 200
    summary = client.get(f"/api/sessions/{practice['id']}/summary").json()
    assert summary["needs_practice"][0]["entry_id"] == before[0]["entry"]["id"]
    assert summary["needs_practice"][0]["rating"] == "again"
