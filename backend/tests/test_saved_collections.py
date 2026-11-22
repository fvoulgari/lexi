from uuid import UUID

from sqlalchemy import select
from test_shareable_collections import H, add, card, collection, publish, session

from app.models import LearningProgress, SavedCollection


def entry_for(client, collection_id):
    return next(
        (c for c in client.get("/api/collections").json() if c["id"] == collection_id),
        None,
    )


def test_saving_is_private_to_the_learner_and_never_grants_writes(
    client, account_client
):
    owner = account_client("owner")
    public = collection(client, "Greetings")
    private = collection(client, "Draft")
    word = card(client, public)
    assert publish(client, public).status_code == 200
    base = f"/api/collections/{public['id']}"
    assert client.put(f"{base}/saved", headers=H).status_code == 422

    account_client("reader")
    assert client.put(f"{base}/saved").status_code == 403
    assert (
        client.put(f"/api/collections/{private['id']}/saved", headers=H).status_code
        == 404
    )
    assert client.put(f"{base}/saved", headers=H).status_code == 204
    assert client.put(f"{base}/saved", headers=H).status_code == 204
    saved = entry_for(client, public["id"])
    assert saved["saved"] is True and saved["can_edit"] is False
    assert saved["owner_name"] == owner["display_name"]
    assert saved["entry_ids"] == [word["id"]]
    with client.app.state.sessions() as db:
        assert len(db.scalars(select(SavedCollection)).all()) == 1

    assert client.patch(base, headers=H, json={"name": "Changed"}).status_code == 403
    assert client.delete(base, headers=H).status_code == 403
    assert (
        client.post(
            f"{base}/cards", headers=H, json={"source_text": "a", "target_text": "b"}
        ).status_code
        == 403
    )
    csv = client.get(
        "/api/vocabulary/export.csv",
        params={"collection_id": public["id"], "include_ids": True},
    )
    assert csv.status_code == 200 and word["id"] in csv.text

    account_client("other-reader")
    assert entry_for(client, public["id"])["saved"] is False
    assert client.delete(f"{base}/saved", headers=H).status_code == 204
    account_client("reader")
    assert entry_for(client, public["id"])["saved"] is True
    assert client.delete(f"{base}/saved", headers=H).status_code == 204
    assert entry_for(client, public["id"])["saved"] is False
    account_client("owner")
    assert entry_for(client, public["id"])["entry_ids"] == [word["id"]]


def test_unpublish_hides_saved_collection_and_republish_restores_progress(
    client, account_client
):
    account_client("owner")
    public = collection(client, "Greetings")
    mirror = collection(client, "Greetings again")
    word = card(client, public)
    assert add(client, mirror, word).status_code == 204
    assert publish(client, public).status_code == 200
    base = f"/api/collections/{public['id']}"
    reader = account_client("reader")
    assert client.put(f"{base}/saved", headers=H).status_code == 204
    queue = session(client, reader, [public]).json()
    path = f"/api/sessions/{queue['id']}/cards/0"
    direction = {"direction": "italian_to_greek"}
    assert client.post(path + "/reveal", headers=H, json=direction).status_code == 200
    assert (
        client.post(
            path + "/reviews", headers=H, json={**direction, "rating": "hard"}
        ).status_code
        == 200
    )
    assert client.delete(f"{base}/saved", headers=H).status_code == 204
    assert client.put(f"{base}/saved", headers=H).status_code == 204

    account_client("owner")
    assert client.post(f"{base}/unpublish", headers=H).status_code == 200
    account_client("reader")
    assert entry_for(client, public["id"]) is None
    assert client.get(f"{base}/entries").status_code == 404
    assert session(client, reader, [public]).status_code == 404
    assert (
        client.get(
            "/api/vocabulary/export.csv", params={"collection_id": public["id"]}
        ).status_code
        == 404
    )
    assert (
        client.get(f"/api/sessions/{queue['id']}").json()["cards"][0]["snapshot"]
        is None
    )
    with client.app.state.sessions() as db:
        assert (
            db.get(
                LearningProgress,
                (UUID(reader["profile_id"]), UUID(word["id"]), "italian_to_greek"),
            ).reviews
            == 1
        )

    account_client("owner")
    assert publish(client, public).status_code == 200
    assert publish(client, mirror).status_code == 200
    account_client("reader")
    assert entry_for(client, public["id"])["saved"] is True
    assert (
        session(client, reader, [public, mirror], mode="difficult").json()["available"]
        == 1
    )
    for target in [public, mirror]:
        progress = client.get(
            f"/api/collections/{target['id']}/progress?direction=italian_to_greek"
        ).json()
        assert progress["reviews"] == 1
    account_client("owner")
    assert client.delete(base, headers=H).status_code == 204
    account_client("reader")
    assert entry_for(client, public["id"]) is None
    assert session(client, reader, [public]).status_code == 404
    assert session(client, reader, [mirror], mode="difficult").json()["available"] == 1
    with client.app.state.sessions() as db:
        assert db.scalar(select(SavedCollection)) is None
