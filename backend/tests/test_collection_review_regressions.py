"""Review regressions: grants, storage orientation and owner editing."""

from test_shareable_collections import H, add, card, collection, publish, session


def test_last_owner_publication_controls_access_not_foreign_references(
    client, account_client
):
    account_client("grant-a")
    unit = collection(client, "Unit 1")
    greetings = collection(client, "Greetings")
    entry = card(client, unit)
    assert add(client, greetings, entry).status_code == 204
    assert publish(client, unit).status_code == 200
    assert publish(client, greetings).status_code == 200
    b = account_client("grant-b")
    reference = collection(client, "B references")
    assert add(client, reference, entry).status_code == 204
    assert publish(client, reference).status_code == 200
    queue = session(client, b, [reference]).json()
    account_client("grant-a")
    assert (
        client.post(f"/api/collections/{unit['id']}/unpublish", headers=H).status_code
        == 200
    )
    account_client("grant-b")
    assert client.get(f"/api/vocabulary/{entry['id']}").status_code == 200
    account_client("grant-a")
    assert (
        client.delete(
            f"/api/collections/{greetings['id']}/entries/{entry['id']}", headers=H
        ).status_code
        == 204
    )
    account_client("grant-b")
    assert client.get(f"/api/vocabulary/{entry['id']}").status_code == 404
    assert client.get(f"/api/collections/{reference['id']}/entries").json() == []
    assert client.get(f"/api/collections/{reference['id']}/search?q=ciao").json() == []
    assert session(client, b, [reference]).status_code == 409
    stale = client.get(f"/api/sessions/{queue['id']}").json()
    assert stale["cards"][0]["snapshot"] is None


def test_workspace_greek_italian_card_has_legacy_vocabulary_and_csv_columns(
    client, account_client
):
    account_client("compatibility")
    c = collection(client)
    entry = card(client, c, "γεια", "ciao")
    library = client.get("/api/vocabulary").json()["items"]
    item = next((e for e in library if e["id"] == entry["id"]), None)
    assert item is not None
    assert item["italian"] == "ciao" and item["greek"] == "γεια"
    exported = client.get("/api/vocabulary/export.csv").text
    import csv
    import io

    rows = list(csv.DictReader(io.StringIO(exported.lstrip("\ufeff"))))
    assert any(row["italian"] == "ciao" and row["greek"] == "γεια" for row in rows)


def test_existing_editor_saves_shared_owned_card_with_private_unit(
    client, account_client
):
    account_client("editable-owner")
    unit = client.post(
        "/api/units",
        headers=H,
        json={"code": "P", "title": "Private unit", "sort_order": 0},
    ).json()
    saved = client.post(
        "/api/vocabulary",
        headers=H,
        json={
            "italian": "ciao",
            "greek": "γεια",
            "word_type": "expression",
            "unit_id": unit["id"],
        },
    )
    assert saved.status_code == 201, saved.text
    entry = saved.json()["entry"]
    c = collection(client)
    assert add(client, c, entry).status_code == 204
    assert publish(client, c).status_code == 200
    changed = client.patch(
        f"/api/vocabulary/{entry['id']}", headers=H, json={"italian": "ciao!"}
    )
    assert changed.status_code == 200, changed.text


def reviewed(client, queue, direction="italian_to_greek", rating="hard"):
    path = f"/api/sessions/{queue['id']}/cards/0"
    assert (
        client.post(
            path + "/reveal", headers=H, json={"direction": direction}
        ).status_code
        == 200
    )
    assert (
        client.post(
            path + "/reviews",
            headers=H,
            json={"direction": direction, "rating": rating},
        ).status_code
        == 200
    )


def test_republication_preserves_difficulty_unique_totals_and_all_references(
    client, account_client
):
    a = account_client("republish-a")
    first, second = collection(client, "Unit 1"), collection(client, "Greetings")
    entry = card(client, first)
    assert add(client, second, entry).status_code == 204
    assert publish(client, first).status_code == 200
    # Each creator-owned collection must independently confirm its private cards,
    # even when another confirmed grant already makes the card accessible.
    preview = client.get(f"/api/collections/{second['id']}/publish-preview").json()
    assert [e["id"] for e in preview["private_cards"]] == [entry["id"]]
    assert publish(client, second).status_code == 200
    b = account_client("republish-b")
    mine = collection(client, "References only")
    assert add(client, mine, entry).status_code == 204
    assert publish(client, mine).status_code == 200
    queue = session(client, b, [first, second, mine]).json()
    assert queue["available"] == 1 and len(queue["cards"]) == 1
    reviewed(client, queue)
    reverse = session(client, b, [mine], direction="greek_to_italian").json()
    reviewed(client, reverse, direction="greek_to_italian")
    account_client("republish-a")
    preview = client.get(f"/api/collections/{first['id']}/unpublish-preview").json()
    assert preview["private_cards"] == []
    assert [e["id"] for e in preview["still_shared_cards"]] == [entry["id"]]
    assert (
        client.post(f"/api/collections/{first['id']}/unpublish", headers=H).status_code
        == 200
    )
    preview = client.get(f"/api/collections/{second['id']}/unpublish-preview").json()
    assert [e["id"] for e in preview["private_cards"]] == [entry["id"]]
    assert (
        client.delete(f"/api/collections/{second['id']}", headers=H).status_code == 204
    )
    account_client("republish-b")
    assert session(client, b, [mine], mode="difficult").status_code == 409
    stale = client.get(f"/api/sessions/{queue['id']}").json()
    assert stale["cards"][0]["snapshot"] is None
    summary = client.get(f"/api/sessions/{queue['id']}/summary").json()
    assert summary["needs_practice"][0]["snapshot"] is None
    assert (
        client.post(
            f"/api/sessions/{queue['id']}/cards/0/reveal",
            headers=H,
            json={"direction": "italian_to_greek"},
        ).status_code
        == 409
    )
    assert client.get("/api/vocabulary").json()["items"] == []
    assert "ciao" not in client.get("/api/vocabulary/export.csv").text
    account_client("republish-a")
    assert publish(client, first).status_code == 200
    account_client("republish-b")
    assert (
        client.get(f"/api/collections/{mine['id']}/entries").json()[0]["id"]
        == entry["id"]
    )
    assert session(client, b, [first, mine], mode="difficult").json()["available"] == 1
    totals = client.get(f"/api/profiles/{b['profile_id']}/progress").json()
    assert totals["entries_practised"] == 1 and totals["total_reviews"] == 2
    assert totals["difficult_entries"] == 1 and totals["vocabulary_count"] == 1
    assert client.get(f"/api/profiles/{a['profile_id']}/progress").status_code == 404


def test_shared_card_never_shares_private_unit_tags_or_editor_rights(
    client, account_client
):
    account_client("metadata-owner")
    unit = client.post(
        "/api/units",
        headers=H,
        json={"code": "SECRET", "title": "Private chapter", "sort_order": 0},
    ).json()
    tag = client.post("/api/tags", headers=H, json={"name": "Private theme"}).json()
    saved = client.post(
        "/api/vocabulary",
        headers=H,
        json={
            "italian": "ciao",
            "greek": "γεια",
            "word_type": "expression",
            "unit_id": unit["id"],
            "tag_ids": [tag["id"]],
        },
    ).json()["entry"]
    c = collection(client)
    assert add(client, c, saved).status_code == 204
    assert publish(client, c).status_code == 200
    # Existing editor submits unit/tag values even when changing only text.
    changed = client.patch(
        f"/api/vocabulary/{saved['id']}",
        headers=H,
        json={"italian": "ciao!", "unit_id": unit["id"], "tag_ids": [tag["id"]]},
    )
    assert changed.status_code == 200, changed.text
    updated = client.patch(
        f"/api/collections/cards/{saved['id']}",
        headers=H,
        json={"source_text": "ciao!!", "target_text": "γεια"},
    )
    assert updated.status_code == 200
    b = account_client("metadata-reader", role="editor")
    visible = client.get(f"/api/vocabulary/{saved['id']}").json()
    assert (
        visible["italian"] == "ciao!!"
        and visible["unit"] is None
        and visible["tags"] == []
    )
    assert (
        client.get("/api/units").json() == [] and client.get("/api/tags").json() == []
    )
    assert (
        client.patch(
            f"/api/vocabulary/{saved['id']}", headers=H, json={"italian": "stolen"}
        ).status_code
        == 403
    )
    assert (
        client.patch(
            f"/api/collections/cards/{saved['id']}",
            headers=H,
            json={"source_text": "stolen", "target_text": "γεια"},
        ).status_code
        == 403
    )
    queue = session(client, b, [c]).json()
    assert queue["cards"][0]["snapshot"]["unit"] is None
    assert queue["cards"][0]["snapshot"]["tags"] == []


def test_owner_can_add_new_confirmed_grant_but_foreign_owner_cannot_extend_it(
    client, account_client
):
    account_client("adding-owner")
    first, second = collection(client, "One"), collection(client, "Two")
    entry = card(client, first)
    assert publish(client, first).status_code == 200
    assert publish(client, second).status_code == 200
    assert add(client, second, entry).status_code == 409
    assert add(client, second, entry, [entry["id"]]).status_code == 204
    b = account_client("adding-reader")
    mine = collection(client, "Foreign references")
    assert publish(client, mine).status_code == 200
    assert add(client, mine, entry, [entry["id"]]).status_code == 409
    assert add(client, mine, entry).status_code == 204
    account_client("adding-owner")
    assert (
        client.delete(f"/api/collections/{first['id']}", headers=H).status_code == 204
    )
    account_client("adding-reader")
    assert session(client, b, [mine]).status_code == 201
    account_client("adding-owner")
    assert (
        client.delete(
            f"/api/collections/{second['id']}/entries/{entry['id']}", headers=H
        ).status_code
        == 204
    )
    account_client("adding-reader")
    assert client.get(f"/api/vocabulary/{entry['id']}").status_code == 404


def test_vocabulary_create_selects_only_owned_compatible_collection_with_confirmation(
    client, account_client
):
    account_client("create-a")
    c = collection(client)
    unit = client.post(
        "/api/units",
        headers=H,
        json={"code": "UI", "title": "Private", "sort_order": 0},
    ).json()
    body = {
        "italian": "ciao",
        "greek": "γεια",
        "word_type": "expression",
        "unit_id": unit["id"],
        "collection_id": c["id"],
    }
    created = client.post("/api/vocabulary", headers=H, json=body)
    assert created.status_code == 201, created.text
    entry = created.json()["entry"]
    assert entry["visibility"] == "private"
    assert [
        e["id"] for e in client.get(f"/api/collections/{c['id']}/entries").json()
    ] == [entry["id"]]
    assert publish(client, c).status_code == 200
    count = client.get("/api/vocabulary").json()["total"]
    assert client.post("/api/vocabulary", headers=H, json=body).status_code == 409
    assert client.get("/api/vocabulary").json()["total"] == count
    shared = client.post(
        "/api/vocabulary", headers=H, json={**body, "confirm_collection_exposure": True}
    )
    assert shared.status_code == 201, shared.text
    shared_id = shared.json()["entry"]["id"]
    account_client("create-b")
    assert client.get(f"/api/vocabulary/{shared_id}").status_code == 200
    foreign_unit = client.post(
        "/api/units", headers=H, json={"code": "B", "title": "B", "sort_order": 0}
    ).json()
    assert (
        client.post(
            "/api/vocabulary",
            headers=H,
            json={
                **body,
                "unit_id": foreign_unit["id"],
                "confirm_collection_exposure": True,
            },
        ).status_code
        == 403
    )
    wrong = collection(client, "Wrong", "en", "da")
    assert (
        client.post(
            "/api/vocabulary",
            headers=H,
            json={**body, "unit_id": foreign_unit["id"], "collection_id": wrong["id"]},
        ).status_code
        == 422
    )
    account_client("create-a")
    assert (
        client.post(f"/api/collections/{c['id']}/unpublish", headers=H).status_code
        == 200
    )
    account_client("create-b")
    assert client.get(f"/api/vocabulary/{shared_id}").status_code == 404
