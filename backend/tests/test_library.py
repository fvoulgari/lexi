def test_library_requires_the_shared_password_gate(client):
    response = client.get("/api/vocabulary")
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "authentication_required"


def test_shared_password_opens_the_gate(client):
    state = client.get("/api/auth/session").json()
    assert state["authenticated"] is False
    response = client.post(
        "/api/auth/login",
        json={"password": "test-notebook-password"},
        headers={"X-CSRF-Token": state["csrf_token"]},
    )
    assert response.status_code == 200
    assert client.get("/api/auth/session").json()["authenticated"] is True


def test_seeded_library_is_paginated_without_repeated_entries(client):
    state = client.get("/api/auth/session").json()
    client.post(
        "/api/auth/login",
        json={"password": "test-notebook-password"},
        headers={"X-CSRF-Token": state["csrf_token"]},
    )
    first = client.get("/api/vocabulary?page=1&page_size=6").json()
    second = client.get("/api/vocabulary?page=2&page_size=6").json()
    assert first["total"] == second["total"] == 10
    assert len(first["items"]) == 6
    assert len(second["items"]) == 4
    entries = first["items"] + second["items"]
    assert len({entry["id"] for entry in entries}) == 10
    assert {entry["unit"]["code"] for entry in entries} == {"00"}
    house = next(entry for entry in entries if entry["italian"] == "la casa")
    assert house["greek"] == "το σπίτι"
    assert house["italian_gender"] == "feminine"
    assert house["greek_gender"] == "neuter"


def test_private_responses_cannot_be_cached(logged_in):
    assert logged_in.get("/api/vocabulary").headers["cache-control"] == "no-store"


def test_seeded_profiles_and_units_are_only_visible_inside_gate(client, logged_in):
    assert {
        profile["display_name"] for profile in logged_in.get("/api/profiles").json()
    } >= {"Foteini", "Spyros"}
    assert [unit["code"] for unit in logged_in.get("/api/units").json()] == ["00", "01"]
    logged_in.cookies.clear()
    assert client.get("/api/profiles").status_code == 401
    assert client.get("/api/units").status_code == 401


def test_invalid_pagination_and_out_of_range_pages(logged_in):
    assert logged_in.get("/api/vocabulary?page=0").status_code == 422
    assert logged_in.get("/api/vocabulary?page_size=101").status_code == 422
    page = logged_in.get("/api/vocabulary?page=100").json()
    assert page["items"] == []
    assert page["total"] == 10


def test_production_shell_and_api_paths_are_distinct(client):
    page = client.get("/vocabulary")
    assert page.status_code == 200
    assert 'id="root"' in page.text
    unknown = client.get("/api/missing")
    assert unknown.status_code == 404
