"""Explicit bilingual gender on writes, without migrating or blocking legacy reviews."""

import pytest
from sqlalchemy import create_engine, text
from test_practice import start
from test_vocabulary_editing import headers


def body(client, category):
    return {
        "unit_id": client.get("/api/units").json()[0]["id"],
        "italian": "l’artista" if category == "noun" else "alta",
        "greek": "καλλιτέχνης" if category == "noun" else "ψηλή",
        "word_type": category,
    }


def fields(category):
    return (
        ("italian_gender", "greek_gender")
        if category == "noun"
        else ("italian_adjective_gender", "greek_adjective_gender")
    )


@pytest.mark.parametrize("category", ["noun", "adjective"])
def test_new_card_requires_both_explicit_genders_and_forms_stay_optional(
    logged_in, category
):
    client = logged_in
    data = body(client, category)
    italian, greek = fields(category)
    path = "/api/vocabulary"
    response = client.post(path, json=data, headers=headers(client))
    assert response.status_code == 422
    assert set(response.json()["error"]["fields"]) == {italian, greek}
    for value in (None, "masculine"):
        response = client.post(
            path, json={**data, italian: value}, headers=headers(client)
        )
        assert response.status_code == 422
        assert greek in response.json()["error"]["fields"]
    for language_field, value in [(italian, "neuter"), (greek, "common")]:
        response = client.post(
            path,
            json={**data, italian: "feminine", greek: "neuter", language_field: value},
            headers=headers(client),
        )
        assert response.status_code == 422
        assert language_field in response.json()["error"]["fields"]
    response = client.post(
        path,
        json={**data, italian: "feminine", greek: "neuter"},
        headers=headers(client),
    )
    assert response.status_code == 201
    entry = response.json()["entry"]
    assert entry["italian"] == data["italian"]
    assert entry[italian] == "feminine"
    assert entry[greek] == "neuter"
    assert entry["italian_plural"] is None
    assert entry["greek_neuter_plural"] is None
    # A partial edit may retain already-known genders, but cannot clear one.
    path += "/" + entry["id"]
    assert (
        client.patch(
            path, json={"pronunciation": "άλτα"}, headers=headers(client)
        ).status_code
        == 200
    )
    response = client.patch(path, json={greek: None}, headers=headers(client))
    assert response.status_code == 422
    assert response.json()["error"]["fields"] == [greek]


@pytest.mark.parametrize("category", ["noun", "adjective"])
def test_missing_legacy_genders_are_reviewable_but_must_be_corrected_on_save(
    logged_in, test_database, category
):
    client = logged_in
    italian, greek = fields(category)
    original = client.post(
        "/api/vocabulary",
        json={
            **body(client, category),
            italian: "feminine",
            greek: "neuter",
            "notes": "Preserve archived note",
        },
        headers=headers(client),
    ).json()["entry"]
    engine = create_engine(test_database)
    with engine.begin() as connection:
        connection.execute(
            text(
                f"UPDATE vocabulary_entries SET {italian}=NULL, "
                f"{greek}=NULL WHERE id=:id"
            ),
            {"id": original["id"]},
        )
    path = "/api/vocabulary/" + original["id"]
    legacy = client.get(path).json()
    assert legacy[italian] is None and legacy[greek] is None
    session = start(client, size=None).json()
    card = next(c for c in session["cards"] if c["entry_id"] == original["id"])
    review_path = f"/api/sessions/{session['id']}/cards/{card['position']}"
    assert (
        client.post(
            review_path + "/reveal",
            json={"direction": session["direction"]},
            headers=headers(client),
        ).status_code
        == 200
    )
    assert (
        client.post(
            review_path + "/reviews",
            json={"direction": session["direction"], "rating": "easy"},
            headers=headers(client),
        ).status_code
        == 200
    )
    before = client.get(f"/api/profiles/{session['profile_id']}/progress").json()
    response = client.patch(
        path, json={"italian_example": "Draft"}, headers=headers(client)
    )
    assert response.status_code == 422
    assert set(response.json()["error"]["fields"]) == {italian, greek}
    assert client.get(path).json() == legacy
    response = client.patch(
        path,
        json={italian: "feminine", greek: "neuter", "italian_example": "Saved"},
        headers=headers(client),
    )
    assert response.status_code == 200
    assert response.json()["entry"]["notes"] == "Preserve archived note"
    assert (
        client.get(f"/api/profiles/{session['profile_id']}/progress").json() == before
    )
    engine.dispose()


def test_csv_reports_language_and_row_and_validates_merged_updates(logged_in):
    client = logged_in
    unit = client.get("/api/units").json()[0]["id"]
    content = (
        "italian,greek,word_type,italian_gender,greek_gender,italian_adjective_gender,greek_adjective_gender\n"
        "nuovo nome,όνομα,noun,,,,\n"
        "alta,ψηλή,adjective,,,feminine,\n"
        "il biglietto,εισιτήριο,noun,masculine,neuter,,\n"
    )

    def upload(content, action):
        return client.post(
            f"/api/imports/{action}?unit_id={unit}",
            content=content.encode(),
            headers=headers(client),
        ).json()

    for action in ["preview", "confirm"]:
        report = upload(content, action)
        assert report["counts"]["error"] == 2
        assert report["rows"][0]["row"] == 2
        assert report["rows"][1]["row"] == 3
        assert any("Italian" in error for error in report["rows"][0]["errors"])
        assert any("Greek" in error for error in report["rows"][0]["errors"])
        assert any("Greek" in error for error in report["rows"][1]["errors"])
    update = (
        "italian,greek,word_type,pronunciation\nil biglietto,εισιτήριο,noun,μπιλιέτο\n"
    )
    assert upload(update, "confirm")["counts"]["updated"] == 1
    new_missing = "italian,greek,word_type\nnew noun,νέο,noun\n"
    assert upload(new_missing, "confirm")["counts"]["error"] == 1
