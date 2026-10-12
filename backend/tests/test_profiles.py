from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import create_app


def headers(client):
    return {"X-CSRF-Token": client.get("/api/auth/session").json()["csrf_token"]}


def test_profile_preferences_persist_across_application_instances(logged_in):
    response = logged_in.post(
        "/api/profiles", json={"display_name": "  Μαρία  "}, headers=headers(logged_in)
    )
    assert response.status_code == 201
    profile = response.json()
    assert profile["display_name"] == "Μαρία"
    assert profile["preferred_direction"] == "greek_to_italian"
    assert profile["default_session_size"] == 25
    updated = logged_in.patch(
        f"/api/profiles/{profile['id']}",
        json={"preferred_direction": "italian_to_greek", "default_session_size": 10},
        headers=headers(logged_in),
    )
    assert updated.status_code == 200
    with TestClient(create_app()) as other_device:
        other_device.post(
            "/api/auth/login",
            json={"password": "test-notebook-password"},
            headers=headers(other_device),
        )
        saved = other_device.get(f"/api/profiles/{profile['id']}").json()
        assert saved == updated.json()
        assert saved in other_device.get("/api/profiles").json()
    renamed = logged_in.patch(
        f"/api/profiles/{profile['id']}",
        json={"display_name": "Maria"},
        headers=headers(logged_in),
    ).json()
    assert renamed["display_name"] == "Maria"
    assert renamed["default_session_size"] == 10


def test_profile_validation_and_missing_profiles(logged_in):
    for body in [
        {"display_name": "   "},
        {"display_name": "x" * 81},
        {"display_name": "Name", "preferred_direction": "invalid"},
        {"display_name": "Name", "default_session_size": 0},
        {"display_name": "Name", "default_session_size": 101},
        {"display_name": "Name", "default_session_size": 2.5},
    ]:
        assert (
            logged_in.post(
                "/api/profiles", json=body, headers=headers(logged_in)
            ).status_code
            == 422
        )
    missing = f"/api/profiles/{uuid4()}"
    assert logged_in.get(missing).status_code == 404
    assert (
        logged_in.patch(
            missing, json={"display_name": "Name"}, headers=headers(logged_in)
        ).status_code
        == 404
    )
    profile = logged_in.get("/api/profiles").json()[0]
    for body in [
        {"display_name": None},
        {"preferred_direction": None},
        {"display_name": "\n\t"},
    ]:
        assert (
            logged_in.patch(
                f"/api/profiles/{profile['id']}", json=body, headers=headers(logged_in)
            ).status_code
            == 422
        )


def test_profile_mutations_require_gate_and_csrf(client, logged_in):
    profile = logged_in.get("/api/profiles").json()[0]
    path = f"/api/profiles/{profile['id']}"
    assert (
        logged_in.post("/api/profiles", json={"display_name": "Name"}).status_code
        == 403
    )
    assert logged_in.patch(path, json={"display_name": "Name"}).status_code == 403
    logged_in.cookies.clear()
    assert client.get(path).status_code == 401
    assert (
        client.post("/api/profiles", json={"display_name": "Name"}).status_code == 401
    )
    assert client.patch(path, json={"display_name": "Name"}).status_code == 401


def test_all_entries_preference_persists(logged_in):
    profile = logged_in.post(
        "/api/profiles",
        json={"display_name": "All entries", "default_session_size": None},
        headers=headers(logged_in),
    ).json()
    assert (
        logged_in.get(f"/api/profiles/{profile['id']}").json()["default_session_size"]
        is None
    )
    assert (
        logged_in.patch(
            f"/api/profiles/{profile['id']}",
            json={"default_session_size": 30},
            headers=headers(logged_in),
        ).status_code
        == 422
    )
