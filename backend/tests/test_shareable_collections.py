"""Collection references share learning state, never ownership or audience."""

import pytest
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


def test_export_does_not_expose_private_source_collection_metadata(
    client, account_client
):
    from uuid import UUID

    from app.models import Collection, VocabularyEntry

    account_client("source-metadata-owner")
    private = collection(client, "Private source")
    public = collection(client, "Shared")
    entry = card(client, private)
    with client.app.state.sessions.begin() as db:
        source = db.get(Collection, UUID(private["id"]))
        source.source_unit_code = "PRIVATE-CODE"
        source.source_unit_title = "PRIVATE-TITLE"
        db.get(VocabularyEntry, UUID(entry["id"])).source_collection_id = source.id
    assert add(client, public, entry).status_code == 204
    assert publish(client, public).status_code == 200
    reader = account_client("source-metadata-reader")
    response = client.get("/api/vocabulary/export.csv")
    assert response.status_code == 200
    assert "PRIVATE-CODE" not in response.text
    assert "PRIVATE-TITLE" not in response.text
    queue = session(client, reader, [public]).json()
    assert queue["cards"][0]["snapshot"]["unit"] is None


def test_renamed_public_collection_does_not_expose_old_private_metadata(
    client, account_client
):
    from uuid import UUID

    from app.models import Collection, VocabularyEntry

    account_client("renamed-source-owner")
    source = collection(client, "Private title")
    entry = card(client, source)
    with client.app.state.sessions.begin() as db:
        group = db.get(Collection, UUID(source["id"]))
        group.source_unit_code = "OLD-SECRET"
        group.source_unit_title = "Old secret title"
        db.get(VocabularyEntry, UUID(entry["id"])).source_collection_id = group.id
    assert (
        client.patch(
            f"/api/collections/{source['id']}", headers=H, json={"name": "Public title"}
        ).status_code
        == 200
    )
    assert publish(client, source).status_code == 200
    reader = account_client("renamed-source-reader")
    response = client.get("/api/vocabulary/export.csv")
    assert "OLD-SECRET" not in response.text
    assert "Old secret title" not in response.text
    assert (
        session(client, reader, [source]).json()["cards"][0]["snapshot"]["unit"] is None
    )


@pytest.mark.parametrize("reader_owns_card", [False, True])
def test_legacy_snapshot_metadata_stays_private_when_card_is_republished(
    client, account_client, reader_owns_card
):
    from uuid import UUID, uuid4

    from sqlalchemy import select

    from app.models import Collection, ReviewEvent, SessionCard, Tag

    account_client("legacy-snapshot-owner")
    private = collection(client, "Private group")
    public = collection(client, "Public group")
    entry = card(client, private)
    assert add(client, public, entry).status_code == 204
    assert publish(client, public).status_code == 200
    unit_id, tag_id = uuid4(), uuid4()
    with client.app.state.sessions.begin() as db:
        group = db.get(Collection, UUID(private["id"]))
        group.source_unit_id = unit_id
        group.source_unit_code = "SECRET"
        group.source_unit_title = "Private title"
        db.add(
            Tag(
                id=tag_id,
                name="Private tag",
                owner_account_id=group.owner_account_id,
                visibility="private",
            )
        )
    reader = account_client("legacy-snapshot-reader")
    destination = collection(client, "Reader group") if reader_owns_card else public
    if reader_owns_card:
        card(client, destination)
    queue = session(client, reader, [destination]).json()
    secret_unit = {"id": str(unit_id), "code": "SECRET", "title": "Private title"}
    secret_tag = {"id": str(tag_id), "name": "Private tag"}
    with client.app.state.sessions.begin() as db:
        saved = db.get(SessionCard, (UUID(queue["id"]), 0))
        saved.snapshot = {**saved.snapshot, "unit": secret_unit, "tags": [secret_tag]}
    path = f"/api/sessions/{queue['id']}/cards/0"
    assert (
        client.post(
            path + "/reveal", headers=H, json={"direction": "italian_to_greek"}
        ).status_code
        == 200
    )
    review = client.post(
        path + "/reviews",
        headers=H,
        json={"direction": "italian_to_greek", "rating": "hard"},
    )
    assert review.status_code == 200
    for response in (
        review,
        client.get(f"/api/sessions/{queue['id']}"),
        client.get(f"/api/sessions/{queue['id']}/summary"),
        client.get(f"/api/profiles/{reader['profile_id']}/progress"),
    ):
        assert response.status_code == 200
        assert "Private title" not in response.text
        assert "Private tag" not in response.text
        assert "SECRET" not in response.text
    progress = client.get(f"/api/profiles/{reader['profile_id']}/progress").json()
    assert progress["total_reviews"] == 1
    assert progress["difficult_entries"] == 1
    with client.app.state.sessions() as db:
        event = db.scalar(
            select(ReviewEvent).where(ReviewEvent.session_id == UUID(queue["id"]))
        )
        assert event.snapshot["unit"] == secret_unit
        assert event.snapshot["tags"] == [secret_tag]


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


def test_full_card_creation_uses_collection_and_preserves_internal_unit_on_edit(
    client, account_client
):
    account_client("collection-card-owner")
    destination = collection(client)
    response = client.post(
        "/api/vocabulary",
        headers=H,
        json={
            "collection_id": destination["id"],
            "italian": "ciao",
            "greek": "γεια",
            "word_type": "expression",
        },
    )
    assert response.status_code == 201, response.text
    entry = response.json()["entry"]
    assert entry["unit"] is None
    assert (
        client.get(f"/api/collections/{destination['id']}/entries").json()[0]["id"]
        == entry["id"]
    )
    response = client.patch(
        f"/api/vocabulary/{entry['id']}", headers=H, json={"italian": "salve"}
    )
    assert response.status_code == 200, response.text
    assert response.json()["entry"]["unit"] is None
    account_client("other-collection-card-owner")
    response = client.post(
        "/api/vocabulary",
        headers=H,
        json={
            "collection_id": destination["id"],
            "italian": "no",
            "greek": "όχι",
            "word_type": "expression",
        },
    )
    assert response.status_code == 403


def test_bulk_collection_membership_is_atomic_and_preserves_existing_unit(
    client, account_client
):
    account_client("bulk-collection-owner")
    first, second = collection(client, "First"), collection(client, "Second")
    one, two = card(client, first, "ένα", "uno"), card(client, first, "δύο", "due")
    assert client.get(f"/api/vocabulary/{one['id']}").json()["unit"] is None
    body = {
        "action": "add_to_collection",
        "collection_id": second["id"],
        "entry_ids": [one["id"], two["id"]],
    }
    assert client.post("/api/vocabulary/bulk", json=body, headers=H).status_code == 200
    assert client.post("/api/vocabulary/bulk", json=body, headers=H).status_code == 200
    assert {
        e["id"] for e in client.get(f"/api/collections/{second['id']}/entries").json()
    } == {one["id"], two["id"]}
    assert client.get(f"/api/vocabulary/{one['id']}").json()["unit"] is None
    assert publish(client, second).status_code == 200
    assert client.post("/api/vocabulary/bulk", json=body, headers=H).status_code == 409


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
