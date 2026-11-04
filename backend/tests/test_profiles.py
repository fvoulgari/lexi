from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import create_app


def headers(client):
    return {"X-CSRF-Token": client.get("/api/auth/session").json()["csrf_token"]}


def test_profile_preferences_persist_across_application_instances(logged_in):
    own = logged_in.get("/api/profiles").json()[0]
    response = logged_in.patch(
        f"/api/profiles/{own['id']}",
        json={"display_name": "  Μαρία  "},
        headers=headers(logged_in),
    )
    assert response.status_code == 200
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
        from conftest import signin

        signin(other_device)
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
    own = logged_in.get("/api/profiles").json()[0]
    for body in [
        {"display_name": "   "},
        {"display_name": "x" * 81},
        {"display_name": "Name", "preferred_direction": "invalid"},
        {"display_name": "Name", "default_session_size": 0},
        {"display_name": "Name", "default_session_size": 101},
        {"display_name": "Name", "default_session_size": 2.5},
    ]:
        assert (
            logged_in.patch(
                f"/api/profiles/{own['id']}", json=body, headers=headers(logged_in)
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
        == 405
    )
    assert logged_in.patch(path, json={"display_name": "Name"}).status_code == 403
    logged_in.cookies.clear()
    assert client.get(path).status_code == 401
    assert (
        client.post("/api/profiles", json={"display_name": "Name"}).status_code == 405
    )
    assert client.patch(path, json={"display_name": "Name"}).status_code == 401


def test_all_entries_preference_persists(logged_in):
    own = logged_in.get("/api/profiles").json()[0]
    profile = logged_in.patch(
        f"/api/profiles/{own['id']}",
        json={"default_session_size": None},
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


def test_profile_deletion_is_disabled_and_preserves_history(logged_in):
    from test_practice import start

    profile = logged_in.get("/api/profiles").json()[0]
    session = start(logged_in).json()
    path = f"/api/sessions/{session['id']}/cards/0"
    auth = headers(logged_in)
    logged_in.post(
        path + "/reveal", json={"direction": "greek_to_italian"}, headers=auth
    )
    assert (
        logged_in.post(
            path + "/reviews",
            json={"direction": "greek_to_italian", "rating": "easy"},
            headers=auth,
        ).status_code
        == 200
    )
    assert (
        logged_in.delete(f"/api/profiles/{profile['id']}", headers=auth).status_code
        == 405
    )
    assert logged_in.get(f"/api/sessions/{session['id']}/summary").json()["total"] == 1
    assert (
        len(logged_in.get(f"/api/profiles/{profile['id']}/learning-records").json())
        == 1
    )


def test_delete_profile_requires_authentication_and_csrf(client, logged_in):
    profile = logged_in.get("/api/profiles").json()[0]
    path = f"/api/profiles/{profile['id']}"
    assert logged_in.delete(path).status_code == 405
    assert logged_in.get(path).status_code == 200
    logged_in.cookies.clear()
    assert client.delete(path).status_code == 405


def test_accounts_cannot_create_additional_or_delete_last_profile(logged_in):
    profiles = logged_in.get("/api/profiles").json()
    assert len(profiles) == 1
    assert (
        logged_in.delete(
            f"/api/profiles/{profiles[0]['id']}", headers=headers(logged_in)
        ).status_code
        == 405
    )
    assert (
        logged_in.post(
            "/api/profiles",
            json={"display_name": "Fresh start"},
            headers=headers(logged_in),
        ).status_code
        == 405
    )
    assert logged_in.get("/api/profiles").json() == profiles


def test_profile_deletion_and_review_do_not_leave_partial_history(logged_in):
    profile = logged_in.get("/api/profiles").json()[0]
    auth = headers(logged_in)
    session = logged_in.post(
        "/api/sessions",
        json={"profile_id": profile["id"], "direction": "greek_to_italian", "size": 10},
        headers=auth,
    ).json()
    review = f"/api/sessions/{session['id']}/cards/0"
    assert (
        logged_in.post(
            review + "/reveal",
            json={"direction": "greek_to_italian"},
            headers=auth,
        ).status_code
        == 200
    )
    barrier = Barrier(2)

    def delete_profile():
        barrier.wait(timeout=10)
        return logged_in.delete(f"/api/profiles/{profile['id']}", headers=auth)

    def save_review():
        barrier.wait(timeout=10)
        return logged_in.post(
            review + "/reviews",
            json={"direction": "greek_to_italian", "rating": "easy"},
            headers=auth,
        )

    with ThreadPoolExecutor(max_workers=2) as executor:
        deletion = executor.submit(delete_profile)
        rating = executor.submit(save_review)
        assert deletion.result(timeout=15).status_code == 405
        assert rating.result(timeout=15).status_code == 200
    assert logged_in.get(f"/api/sessions/{session['id']}").status_code == 200
    assert (
        logged_in.get(f"/api/profiles/{profile['id']}/learning-records").status_code
        == 200
    )
