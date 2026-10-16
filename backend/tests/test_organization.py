from test_vocabulary_editing import headers


def test_units_keep_codes_and_explicit_order_across_requests(logged_in):
    client = logged_in
    response = client.post(
        "/api/units",
        json={
            "code": "003",
            "title": "A later chapter",
            "sort_order": -1,
        },
        headers=headers(client),
    )
    assert response.status_code == 201
    unit = response.json()
    assert unit["code"] == "003"
    assert client.get("/api/units").json()[0] == unit
    duplicate = client.post(
        "/api/units",
        json={
            "code": "003",
            "title": "Duplicate",
            "sort_order": 9,
        },
        headers=headers(client),
    )
    assert duplicate.status_code == 409
    assert (
        client.post(
            "/api/units",
            json={
                "code": "004",
                "title": "Protected",
                "sort_order": 2,
            },
        ).status_code
        == 403
    )


def test_tags_and_unit_assignments_persist_and_can_be_cleared(logged_in):
    client = logged_in
    tags = []
    for name in ["Travel", "Food"]:
        response = client.post(
            "/api/tags", json={"name": name}, headers=headers(client)
        )
        assert response.status_code == 201
        tags.append(response.json())
    assert all(tag in client.get("/api/tags").json() for tag in tags)
    unit = client.get("/api/units").json()[0]
    response = client.post(
        "/api/vocabulary",
        json={
            "italian": "viaggiare",
            "greek": "ταξιδεύω",
            "word_type": "verb",
            "unit_id": unit["id"],
            "tag_ids": [tag["id"] for tag in tags],
        },
        headers=headers(client),
    )
    assert response.status_code == 201
    entry = response.json()["entry"]
    assert {tag["name"] for tag in entry["tags"]} == {"Travel", "Food"}
    assert client.get(f"/api/vocabulary/{entry['id']}").json() == entry
    rejected = client.patch(
        f"/api/vocabulary/{entry['id']}",
        json={"unit_id": None},
        headers=headers(client),
    )
    assert rejected.status_code == 422
    cleared = client.patch(
        f"/api/vocabulary/{entry['id']}", json={"tag_ids": []}, headers=headers(client)
    ).json()["entry"]
    assert cleared["unit"]["id"] == unit["id"]
    assert cleared["tags"] == []


def test_search_and_groups_combine_without_duplicate_pagination(logged_in):
    client = logged_in
    unit = client.get("/api/units").json()[0]
    tags = [
        client.post("/api/tags", json={"name": name}, headers=headers(client)).json()
        for name in ["Home", "Everyday"]
    ]
    ids = []
    for italian, greek, kind, assigned_unit, assigned_tags in [
        ("casa uno", "Σπίτι ένα", "noun", unit["id"], tags),
        ("casa due", "Σπίτι δύο", "expression", unit["id"], tags[:1]),
        ("casa tre", "Σπίτι τρία", "verb", unit["id"], tags[1:]),
        ("casa quattro", "Σπίτι τέσσερα", "noun", unit["id"], []),
    ]:
        ids.append(
            client.post(
                "/api/vocabulary",
                json={
                    "italian": italian,
                    "greek": greek,
                    "word_type": kind,
                    "unit_id": assigned_unit,
                    "tag_ids": [tag["id"] for tag in assigned_tags],
                },
                headers=headers(client),
            ).json()["entry"]["id"]
        )
    params = [
        ("q", "ΣΠΊΤΙ"),
        ("unit_ids", unit["id"]),
        ("no_unit", "true"),
        ("word_types", "noun"),
        ("word_types", "expression"),
        *[("tag_ids", tag["id"]) for tag in tags],
        ("page_size", "1"),
    ]
    first = client.get("/api/vocabulary", params=params).json()
    second = client.get("/api/vocabulary", params=[*params, ("page", "2")]).json()
    assert first["total"] == second["total"] == 2
    assert {first["items"][0]["id"], second["items"][0]["id"]} == set(ids[:2])
    assert client.get("/api/vocabulary", params={"q": "CASA UNO"}).json()["total"] == 1
    assert client.get("/api/vocabulary", params={"q": "%"}).json()["total"] == 0
    assert (
        client.get("/api/vocabulary", params={"word_types": "bad"}).status_code == 422
    )


def test_metadata_and_assignments_validate_without_partial_writes(logged_in):
    from uuid import uuid4

    client = logged_in
    for path, body in [
        ("units", {"code": " ", "title": "Chapter", "sort_order": 1}),
        ("units", {"code": "009", "title": " ", "sort_order": 1}),
        ("tags", {"name": " "}),
        ("tags", {"name": "x" * 81}),
    ]:
        assert (
            client.post(f"/api/{path}", json=body, headers=headers(client)).status_code
            == 422
        )
    tag = client.post(
        "/api/tags", json={"name": "Theme"}, headers=headers(client)
    ).json()
    assert (
        client.post(
            "/api/tags", json={"name": "Theme"}, headers=headers(client)
        ).status_code
        == 409
    )
    assert client.post("/api/tags", json={"name": "Protected"}).status_code == 403
    entry = client.get("/api/vocabulary").json()["items"][0]
    for value in [None, [str(uuid4())]]:
        response = client.patch(
            f"/api/vocabulary/{entry['id']}",
            json={"tag_ids": value, "italian": "changed"},
            headers=headers(client),
        )
        assert response.status_code == 422
        assert response.json()["error"]["fields"] == ["tag_ids"]
        assert (
            client.get(f"/api/vocabulary/{entry['id']}").json()["italian"]
            == entry["italian"]
        )
    saved = client.patch(
        f"/api/vocabulary/{entry['id']}",
        json={"tag_ids": [tag["id"], tag["id"]]},
        headers=headers(client),
    ).json()["entry"]
    assert saved["tags"] == [tag]
    assert client.patch(
        f"/api/vocabulary/{entry['id']}",
        json={"notes": "keep assignment"},
        headers=headers(client),
    ).json()["entry"]["tags"] == [tag]
    client.cookies.clear()
    assert client.get("/api/tags").status_code == 401
    assert (
        client.post(
            "/api/units", json={"code": "9", "title": "Nine", "sort_order": 9}
        ).status_code
        == 401
    )
