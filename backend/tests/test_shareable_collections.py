"""Collection references share learning state, never ownership or audience."""

from conftest import TEST_CSRF

H = {"X-CSRF-Token": TEST_CSRF}


def collection(client, name="Greetings", a="it", b="el"):
    r = client.post(
        "/api/collections",
        headers=H,
        json={"name": name, "source_language": a, "target_language": b},
    )
    assert r.status_code == 201, r.text
    return r.json()


def card(client, c, source="γεια", target="ciao"):
    r = client.post(
        f"/api/collections/{c['id']}/cards",
        headers=H,
        json={"source_text": source, "target_text": target},
    )
    assert r.status_code == 201, r.text
    return r.json()


def add(client, c, e, confirmed=None):
    return client.post(
        f"/api/collections/{c['id']}/entries",
        headers=H,
        json={
            "entry_id": e["id"],
            "confirm_private_ids": confirmed or [],
            "exposure_token": e.get("exposure_token", ""),
        },
    )


def publish(client, c):
    preview = client.get(f"/api/collections/{c['id']}/publish-preview")
    assert preview.status_code == 200, preview.text
    return client.post(
        f"/api/collections/{c['id']}/publish",
        headers=H,
        json={
            "preview_token": preview.json()["preview_token"],
            "confirm_private_ids": [e["id"] for e in preview.json()["private_cards"]],
        },
    )


def session(client, account, collections, direction="italian_to_greek", mode="random"):
    return client.post(
        "/api/sessions",
        headers=H,
        json={
            "profile_id": account["profile_id"],
            "collection_ids": [c["id"] for c in collections],
            "direction": direction,
            "mode": mode,
            "size": None,
        },
    )


def test_ciao_shared_difficulty_combined_queue_unique_totals_and_two_users(
    client, account_client
):
    a = account_client("collection-a")
    unit = collection(client, "Unit 1")
    greetings = collection(client)
    ciao = card(client, unit)
    assert add(client, greetings, ciao).status_code == 204
    assert (
        add(client, greetings, ciao).status_code == 204
    )  # Idempotent, never duplicate.
    assert publish(client, unit).status_code == 200
    assert publish(client, greetings).status_code == 200
    queue = session(client, a, [unit, greetings]).json()
    assert queue["available"] == 1 and len(queue["cards"]) == 1
    path = f"/api/sessions/{queue['id']}/cards/0"
    assert (
        client.post(
            path + "/reveal", headers=H, json={"direction": "italian_to_greek"}
        ).status_code
        == 200
    )
    assert (
        client.post(
            path + "/reviews",
            headers=H,
            json={"direction": "italian_to_greek", "rating": "hard"},
        ).status_code
        == 200
    )
    assert session(client, a, [greetings], mode="difficult").json()["available"] == 1
    assert (
        session(
            client, a, [greetings], direction="greek_to_italian", mode="difficult"
        ).status_code
        == 409
    )
    totals = client.get(f"/api/profiles/{a['profile_id']}/progress").json()
    assert totals["entries_practised"] == 1 and totals["difficult_entries"] == 1
    progress = client.get(
        f"/api/collections/{greetings['id']}/progress?direction=italian_to_greek"
    ).json()
    assert progress == {"card_count": 1, "practised": 1, "reviews": 1, "difficult": 1}
    b = account_client("collection-b")
    assert session(client, b, [greetings], mode="difficult").status_code == 409
    assert session(client, b, [greetings]).json()["available"] == 1
    assert client.get(f"/api/profiles/{a['profile_id']}/progress").status_code == 404
    assert (
        client.patch(
            f"/api/collections/{greetings['id']}", headers=H, json={"name": "stolen"}
        ).status_code
        == 403
    )
    assert (
        client.patch(
            f"/api/collections/cards/{ciao['id']}",
            headers=H,
            json={"source_text": "x", "target_text": "y"},
        ).status_code
        == 403
    )
    mine = collection(client, "B references")
    assert add(client, mine, ciao).status_code == 204
    account_client("collection-a")
    assert (
        client.patch(
            f"/api/collections/cards/{ciao['id']}",
            headers=H,
            json={"source_text": "γεια!", "target_text": "ciao!"},
        ).status_code
        == 200
    )
    assert (
        client.get(f"/api/collections/{greetings['id']}/entries").json()[0][
            "target_text"
        ]
        == "ciao!"
    )
    assert (
        client.post(
            f"/api/collections/{greetings['id']}/unpublish", headers=H
        ).status_code
        == 200
    )
    account_client("collection-b")
    assert client.get(f"/api/collections/{greetings['id']}/entries").status_code == 404
    assert (
        session(client, b, [mine]).status_code == 201
    )  # Unit 1 still has a confirmed creator-owned publication.
    account_client("collection-a")
    assert (
        client.patch(
            f"/api/collections/cards/{ciao['id']}",
            headers=H,
            json={"source_text": "γεια!", "target_text": "ciao!", "withdraw": True},
        ).status_code
        == 200
    )
    account_client("collection-b")
    assert client.get(f"/api/collections/{mine['id']}/entries").json() == []
    assert session(client, b, [mine]).status_code == 409
    account_client("collection-a")
    assert client.delete(f"/api/vocabulary/{ciao['id']}", headers=H).status_code == 200
    retained = client.get(f"/api/profiles/{a['profile_id']}/progress").json()
    assert retained["entries_practised"] == 1 and retained["total_reviews"] == 1


def test_publication_requires_exact_confirmation_and_restricted_cards_fail(
    client, account_client
):
    account_client("publisher", legacy_access=True)
    c = collection(client)
    own = card(client, c)
    path = f"/api/collections/{c['id']}"
    assert client.post(path + "/publish", headers=H, json={}).status_code == 409
    assert publish(client, c).status_code == 200
    private = collection(client, "Private")
    new = card(client, private)
    assert add(client, c, new).status_code == 409
    assert add(client, c, new, [new["id"]]).status_code == 204
    legacy = client.get("/api/vocabulary").json()["items"]
    legacy = next(e for e in legacy if e["visibility"] == "legacy")
    assert add(client, c, legacy).status_code == 409
    restricted = collection(client, "Restricted")
    assert add(client, restricted, legacy).status_code == 204
    assert (
        client.get(f"/api/collections/{restricted['id']}/publish-preview").status_code
        == 409
    )
    assert (
        client.post(
            f"/api/collections/{restricted['id']}/publish", headers=H, json={}
        ).status_code
        == 409
    )
    account_client("outsider")
    assert client.get(f"/api/collections/{private['id']}/entries").status_code == 404
    assert client.get(f"/api/vocabulary/{own['id']}").status_code == 200
    assert client.get(f"/api/vocabulary/{new['id']}").status_code == 200


def test_language_pair_order_and_no_text_merging(client, account_client):
    a = account_client("languages")
    c = collection(client, a="en", b="da")
    one = card(client, c, "hej", "hello")
    two = card(client, c, "hej", "hello")
    assert one["id"] != two["id"]
    other = collection(client)
    assert add(client, other, one).status_code == 422
    path = f"/api/collections/{c['id']}"
    assert (
        client.put(
            path + "/order", headers=H, json={"entry_ids": [two["id"], one["id"]]}
        ).status_code
        == 200
    )
    assert [e["id"] for e in client.get(path + "/entries").json()] == [
        two["id"],
        one["id"],
    ]
    assert (
        client.put(
            path + "/order", headers=H, json={"entry_ids": [one["id"], one["id"]]}
        ).status_code
        == 409
    )
    queue = session(client, a, [c], direction="en_to_da")
    assert queue.status_code == 201, queue.text
    q = queue.json()
    p = f"/api/sessions/{q['id']}/cards/0"
    assert (
        client.post(
            p + "/reveal", headers=H, json={"direction": "italian_to_greek"}
        ).status_code
        == 422
    )
    assert (
        client.post(
            p + "/reveal", headers=H, json={"direction": "en_to_da"}
        ).status_code
        == 200
    )
    assert (
        client.post(
            p + "/reviews", headers=H, json={"direction": "en_to_da", "rating": "again"}
        ).status_code
        == 200
    )
    assert client.delete(path + f"/entries/{one['id']}", headers=H).status_code == 204
    assert client.get(f"/api/vocabulary/{one['id']}").status_code == 200


def test_references_never_expose_foreign_private_cards_or_archived_snapshots(
    client, account_client
):
    a = account_client("private-a")
    c = collection(client)
    entry = card(client, c)
    queue = session(client, a, [c]).json()
    account_client("private-b")
    mine = collection(client, "B")
    assert add(client, mine, entry).status_code == 404
    assert client.get(f"/api/vocabulary/{entry['id']}").status_code == 404
    assert client.get(f"/api/sessions/{queue['id']}").status_code == 404
    account_client("private-a")
    assert client.delete(f"/api/vocabulary/{entry['id']}", headers=H).status_code == 200
    assert client.get(f"/api/collections/{c['id']}/entries").json() == []
    assert session(client, a, [c]).status_code == 409
    rows = client.get("/api/collections").json()
    assert next(row for row in rows if row["id"] == c["id"])[
        "unavailable_entry_ids"
    ] == [entry["id"]]
    assert (
        client.post(
            f"/api/collections/{c['id']}/publish", headers=H, json={}
        ).status_code
        == 409
    )
    assert (
        client.delete(
            f"/api/collections/{c['id']}/entries/{entry['id']}", headers=H
        ).status_code
        == 204
    )
    assert publish(client, c).status_code == 200


def test_published_collection_new_cards_need_explicit_exposure_and_csrf(
    client, account_client
):
    account_client("new-public-card")
    c = collection(client)
    assert publish(client, c).status_code == 200
    path = f"/api/collections/{c['id']}/cards"
    body = {"source_text": "γεια", "target_text": "ciao"}
    assert client.post(path, headers=H, json=body).status_code == 409
    assert client.post(path, json={**body, "confirm_exposure": True}).status_code == 403
    r = client.post(path, headers=H, json={**body, "confirm_exposure": True})
    assert r.status_code == 201 and r.json()["visibility"] == "private"
    assert r.json()["shared_via_collection"] is True
    account_client("reader")
    assert (
        client.get(f"/api/collections/{c['id']}/entries").json()[0]["can_edit"] is False
    )
    assert (
        client.post(f"/api/collections/{c['id']}/unpublish", headers=H).status_code
        == 403
    )
    assert (
        client.put(
            f"/api/collections/{c['id']}/order", headers=H, json={"entry_ids": []}
        ).status_code
        == 403
    )


def test_publication_preview_rejects_changed_text_or_membership(client, account_client):
    account_client("stale-preview")
    c = collection(client)
    entry = card(client, c)
    base = f"/api/collections/{c['id']}"
    preview = client.get(base + "/publish-preview").json()
    assert (
        client.patch(
            f"/api/collections/cards/{entry['id']}",
            headers=H,
            json={"source_text": "changed", "target_text": "ciao"},
        ).status_code
        == 200
    )
    assert (
        client.post(
            base + "/publish",
            headers=H,
            json={
                "preview_token": preview["preview_token"],
                "confirm_private_ids": [entry["id"]],
            },
        ).status_code
        == 409
    )
    assert publish(client, c).status_code == 200


def test_published_add_rejects_stale_private_card_confirmation(client, account_client):
    account_client("stale-add")
    shared = collection(client, "Shared")
    private = collection(client, "Private")
    entry = card(client, private)
    assert publish(client, shared).status_code == 200
    assert (
        client.patch(
            f"/api/collections/cards/{entry['id']}",
            headers=H,
            json={"source_text": "changed", "target_text": "ciao"},
        ).status_code
        == 200
    )
    assert add(client, shared, entry, [entry["id"]]).status_code == 409
