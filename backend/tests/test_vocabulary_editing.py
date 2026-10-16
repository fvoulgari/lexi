import json

from fastapi.testclient import TestClient

from app.main import create_app


def headers(client):
    return {"X-CSRF-Token": client.get("/api/auth/session").json()["csrf_token"]}


def test_meaning_can_be_added_and_edited_across_devices(logged_in):
    body = {
        "unit_id": logged_in.get("/api/units").json()[0]["id"],
        "italian": "  il perché  ",
        "greek": "το γιατί",
        "word_type": "noun",
        "italian_gender": "masculine",
        "greek_gender": "neuter",
        "italian_plural": "i perché",
        "greek_plural": "τα γιατί",
        "italian_example": "Non so il perché.",
        "greek_example": "Δεν ξέρω το γιατί.",
        "notes": "Μία σημασία",
        "pronunciation": "perˈke",
    }
    response = logged_in.post("/api/vocabulary", json=body, headers=headers(logged_in))
    assert response.status_code == 201
    entry = response.json()["entry"]
    assert entry["italian"] == "il perché"
    for field in body.keys() - {"italian", "unit_id"}:
        assert entry[field] == body[field]
    with TestClient(create_app()) as device:
        device.post(
            "/api/auth/login",
            json={"password": "test-notebook-password"},
            headers=headers(device),
        )
        assert device.get(f"/api/vocabulary/{entry['id']}").json() == entry
    updated = logged_in.patch(
        f"/api/vocabulary/{entry['id']}",
        json={"notes": None, "italian_plural": ""},
        headers=headers(logged_in),
    )
    assert updated.status_code == 200
    assert updated.json()["entry"]["notes"] is None
    assert updated.json()["entry"]["italian_plural"] is None
    assert updated.json()["entry"]["id"] == entry["id"]
    assert (
        updated.json()["entry"]
        in logged_in.get("/api/vocabulary?page_size=100").json()["items"]
    )


def test_matching_pairs_warn_but_allow_distinct_meanings(logged_in):
    first = logged_in.post(
        "/api/vocabulary",
        json={
            "unit_id": logged_in.get("/api/units").json()[0]["id"],
            "italian": "il caffè",
            "greek": "ο καφές",
            "word_type": "noun",
        },
        headers=headers(logged_in),
    ).json()
    assert first["duplicate_ids"]
    duplicate = logged_in.post(
        "/api/vocabulary",
        json={
            "unit_id": logged_in.get("/api/units").json()[0]["id"],
            "italian": " IL CAFFE\u0300 ",
            "greek": " Ο ΚΑΦΕ\u0301Σ ",
            "word_type": "noun",
            "notes": "Another meaning",
        },
        headers=headers(logged_in),
    )
    assert duplicate.status_code == 201
    assert first["entry"]["id"] in duplicate.json()["duplicate_ids"]
    updated = logged_in.patch(
        f"/api/vocabulary/{duplicate.json()['entry']['id']}",
        json={"notes": "Updated"},
        headers=headers(logged_in),
    ).json()
    assert updated["entry"]["id"] not in updated["duplicate_ids"]
    for italian, greek in [
        ("il caffe", "ο καφές"),
        ("il caffè", "η καφετέρια"),
        ("caffè", "ο καφές"),
    ]:
        saved = logged_in.post(
            "/api/vocabulary",
            json={
                "unit_id": logged_in.get("/api/units").json()[0]["id"],
                "italian": italian,
                "greek": greek,
                "word_type": "noun",
            },
            headers=headers(logged_in),
        ).json()
        assert saved["duplicate_ids"] == []


def test_input_validation_is_actionable_and_writes_are_protected(logged_in):
    from uuid import uuid4

    valid = {"italian": "è", "greek": "είναι", "word_type": "verb"}
    for change, field in [
        ({"italian": "  "}, "italian"),
        ({"greek": None}, "greek"),
        ({"word_type": "invalid"}, "word_type"),
        ({"italian": "x" * 501}, "italian"),
        ({"greek_gender": "invalid"}, "greek_gender"),
        ({"italian": "\u0000"}, "italian"),
        ({"notes": "\ud800"}, "notes"),
        ({"unit_id": str(uuid4())}, "unit_id"),
        ({"unknown": True}, "unknown"),
    ]:
        response = logged_in.post(
            "/api/vocabulary",
            content=json.dumps({**valid, **change}),
            headers={**headers(logged_in), "Content-Type": "application/json"},
        )
        assert response.status_code == 422
        assert field in response.json()["error"]["fields"]
    assert logged_in.post("/api/vocabulary", json=valid).status_code == 403
    entry = logged_in.get("/api/vocabulary").json()["items"][0]
    path = f"/api/vocabulary/{entry['id']}"
    assert (
        logged_in.patch(
            path, json={"italian": None}, headers=headers(logged_in)
        ).status_code
        == 422
    )
    assert logged_in.patch(path, json={"notes": "test"}).status_code == 403
    assert logged_in.get(f"/api/vocabulary/{uuid4()}").status_code == 404
    assert (
        logged_in.patch(
            f"/api/vocabulary/{uuid4()}",
            json={"notes": "test"},
            headers=headers(logged_in),
        ).status_code
        == 404
    )
    logged_in.cookies.clear()
    assert logged_in.post("/api/vocabulary", json=valid).status_code == 401
    assert logged_in.patch(path, json={"notes": "test"}).status_code == 401
    assert logged_in.get(path).status_code == 401


def test_patch_required_null_errors_identify_the_field(logged_in):
    entry = logged_in.get("/api/vocabulary").json()["items"][0]
    for field in ["italian", "greek", "word_type"]:
        response = logged_in.patch(
            f"/api/vocabulary/{entry['id']}",
            json={field: None},
            headers=headers(logged_in),
        )
        assert response.status_code == 422
        assert response.json()["error"]["fields"] == [field]
