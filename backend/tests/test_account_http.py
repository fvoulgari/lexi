"""Exercise isolation through real HTTP handlers and persisted PostgreSQL state."""

import csv
import io

from conftest import signin
from test_practice import headers, start
from test_progress import submit


def create_unit(client, code="PRIVATE", visibility="private"):
    from uuid import UUID

    from app.models import Collection

    assert visibility == "private", "Use explicit Collection publication"
    response = client.post(
        "/api/collections",
        json={"name": code},
        headers=headers(client),
    )
    assert response.status_code == 201, response.text
    result = response.json()
    with client.app.state.sessions.begin() as db:
        group = db.get(Collection, UUID(result["id"]))
        group.source_unit_id = group.id
        group.source_unit_code = code
        group.source_unit_title = code
        group.source_unit_sort_order = 1
    return {**result, "code": code, "title": code, "sort_order": 1}


def create_card(
    client,
    unit,
    italian="private-secret",
    greek="ιδιωτικό",
    visibility="private",
    tag_ids=None,
):
    response = client.post(
        "/api/vocabulary",
        json={
            "unit_id": unit["id"],
            "italian": italian,
            "greek": greek,
            "word_type": "expression",
            "visibility": visibility,
            "tag_ids": tag_ids or [],
        },
        headers=headers(client),
    )
    assert response.status_code == 201, response.text
    return response.json()


def upload(client, unit, rows, action="preview"):
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["italian", "greek", "word_type", "notes", "tags"])
    writer.writerows(rows)
    return client.post(
        f"/api/imports/{action}?unit_id={unit['id']}",
        content=output.getvalue().encode(),
        headers={**headers(client), "Content-Type": "text/csv"},
    )


def test_guessed_private_ids_never_authorize_another_account(client, account_client):
    owner = account_client("private-owner")
    unit = create_unit(client)
    tag = client.post(
        "/api/tags", json={"name": "private-tag"}, headers=headers(client)
    ).json()
    card = create_card(client, unit, tag_ids=[tag["id"]])["entry"]
    collection = client.post(
        "/api/collections", json={"name": "private-collection"}, headers=headers(client)
    ).json()
    assert (
        client.post(
            f"/api/collections/{collection['id']}/entries",
            json={"entry_id": card["id"]},
            headers=headers(client),
        ).status_code
        == 204
    )
    session = start(client).json()
    submit(client, session, card["id"], "greek_to_italian", "hard")
    other = account_client("private-other")
    assert other["profile_id"] != owner["profile_id"]
    assert client.get("/api/vocabulary").json()["total"] == 0
    assert client.get("/api/vocabulary/selection").json()["entry_ids"] == []
    assert client.get("/api/tags").json() == []
    assert client.get("/api/collections").json() == []
    assert "private-secret" not in client.get("/api/vocabulary/export.csv").text
    for suffix in (
        "",
        "/progress",
        "/learning-records",
        "/difficult-entries?direction=greek_to_italian",
    ):
        assert (
            client.get(f"/api/profiles/{owner['profile_id']}{suffix}").status_code
            == 404
        )
    card_path = f"/api/vocabulary/{card['id']}"
    assert client.get(card_path).status_code == 404
    assert (
        client.patch(
            card_path, json={"notes": "intrusion"}, headers=headers(client)
        ).status_code
        == 404
    )
    assert client.delete(card_path, headers=headers(client)).status_code == 404
    assert (
        client.post(card_path + "/restore", headers=headers(client)).status_code == 404
    )
    session_path = f"/api/sessions/{session['id']}"
    for suffix in ("", "/summary"):
        assert client.get(session_path + suffix).status_code == 404
    assert (
        client.post(
            session_path + "/cards/0/reveal",
            json={"direction": "greek_to_italian"},
            headers=headers(client),
        ).status_code
        == 404
    )
    assert (
        client.post(
            session_path + "/cards/0/reviews",
            json={"direction": "greek_to_italian", "rating": "easy"},
            headers=headers(client),
        ).status_code
        == 404
    )
    assert start(client, profile=owner["profile_id"]).status_code == 404
    collection_path = f"/api/collections/{collection['id']}"
    assert client.get(collection_path + "/entries").status_code == 404
    assert (
        client.patch(
            collection_path, json={"name": "intrusion"}, headers=headers(client)
        ).status_code
        == 404
    )
    assert client.delete(collection_path, headers=headers(client)).status_code == 404
    for action in ("preview", "confirm"):
        assert (
            upload(
                client, unit, [("intrusion", "εισβολή", "expression", "", "")], action
            ).status_code
            == 422
        )
    # An inaccessible same-text card must not surface through duplicate warnings.
    own_unit = create_unit(client)
    saved = create_card(client, own_unit)
    assert saved["duplicate_ids"] == []
    assert (
        client.post(
            "/api/vocabulary",
            json={
                "unit_id": own_unit["id"],
                "italian": "tag attempt",
                "greek": "απόπειρα",
                "word_type": "expression",
                "tag_ids": [tag["id"]],
            },
            headers=headers(client),
        ).status_code
        == 422
    )
    own_collection = client.post(
        "/api/collections", json={"name": "Own"}, headers=headers(client)
    ).json()
    assert (
        client.post(
            f"/api/collections/{own_collection['id']}/entries",
            json={"entry_id": card["id"]},
            headers=headers(client),
        ).status_code
        == 404
    )
    signin(client, "private-owner")
    assert client.get(card_path).json()["notes"] is None
    assert client.get(session_path + "/summary").json()["total"] == 1


def test_mixed_bulk_operations_fail_atomically_without_cross_owner_changes(
    client, account_client
):
    account_client("bulk-a")
    aunit = create_unit(client, "A")
    acard = create_card(client, aunit, "A secret")["entry"]
    account_client("bulk-b")
    bunit = create_unit(client, "B")
    bcard = create_card(client, bunit, "B secret")["entry"]
    destination = create_unit(client, "B-destination")
    for action in ("delete", "add_to_collection"):
        body = {"action": action, "entry_ids": [acard["id"], bcard["id"]]}
        if action == "add_to_collection":
            body["collection_id"] = destination["id"]
        assert (
            client.post(
                "/api/vocabulary/bulk", json=body, headers=headers(client)
            ).status_code
            == 409
        )
        assert [
            e["id"]
            for e in client.get(f"/api/collections/{bunit['id']}/entries").json()
        ] == [bcard["id"]]
        assert client.get(f"/api/collections/{destination['id']}/entries").json() == []
    signin(client, "bulk-a")
    assert [
        e["id"] for e in client.get(f"/api/collections/{aunit['id']}/entries").json()
    ] == [acard["id"]]


def test_editor_permissions_never_grant_private_access_or_admin_roles(
    client, account_client
):
    owner = account_client("owner-with-private")
    unit = create_unit(client)
    card = create_card(client, unit)["entry"]
    account_client("editor", role="editor")
    assert client.get(f"/api/vocabulary/{card['id']}").status_code == 404
    assert (
        client.get(f"/api/profiles/{owner['profile_id']}/progress").status_code == 404
    )
    assert (
        client.patch(
            f"/api/admin/accounts/{owner['id']}",
            json={"role": "admin"},
            headers=headers(client),
        ).status_code
        == 403
    )
    assert client.get(f"/api/collections/{unit['id']}/entries").status_code == 404
    assert (
        client.post(
            f"/api/collections/{unit['id']}/publish", json={}, headers=headers(client)
        ).status_code
        == 404
    )


def test_editor_cannot_import_into_someone_elses_public_collection(
    client, account_client
):
    from test_shareable_collections import card, collection, publish

    signin(client)
    unit = collection(client, "Published")
    existing = card(client, unit, "δημόσιο", "already public")
    assert publish(client, unit).status_code == 200
    account_client("published-editor", role="editor")
    csv_rows = [
        ("already public", "δημόσιο", "expression", "edited by editor", ""),
        ("new publication", "νέα δημοσίευση", "expression", "", ""),
        ("already public", "δημόσιο", "expression", "new tag attempt", "brand-new-tag"),
    ]
    for action in ("preview", "confirm"):
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["italian", "greek", "word_type", "notes", "tags"])
        writer.writerows(csv_rows)
        response = client.post(
            f"/api/imports/{action}?collection_id={unit['id']}",
            content=output.getvalue().encode(),
            headers=headers(client),
        )
        assert response.status_code == 403
    assert client.get(f"/api/vocabulary/{existing['id']}").json()["notes"] is None
    assert client.get("/api/vocabulary").json()["total"] == 1
    assert client.get("/api/tags").json() == []
    assert (
        client.patch(
            f"/api/vocabulary/{existing['id']}/visibility",
            json={"visibility": "published"},
            headers=headers(client),
        ).status_code
        == 403
    )
    assert client.post(
        "/api/vocabulary",
        json={
            "collection_id": unit["id"],
            "italian": "direct publication",
            "greek": "δημοσίευση",
            "word_type": "expression",
            "visibility": "published",
        },
        headers=headers(client),
    ).status_code in (403, 422)
    signin(client)
    assert (
        client.get(f"/api/collections/{unit['id']}/entries").json()[0]["id"]
        == existing["id"]
    )
