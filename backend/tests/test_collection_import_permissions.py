"""CSV import permissions for owned private and public collections."""

from uuid import uuid4

from test_vocabulary_editing import headers

CSV = "italian,greek,word_type\nciao,γεια,expression\n"


def upload(client, action, csv=CSV, **params):
    query = "&".join(f"{key}={value}" for key, value in params.items())
    return client.post(
        f"/api/imports/{action}?{query}",
        headers={**headers(client), "Content-Type": "text/csv"},
        content=csv.encode(),
    )


def test_collection_capabilities_are_explicit(client, account_client):
    account_client("import-capabilities-owner")
    private = client.post(
        "/api/collections", headers=headers(client), json={"name": "Private"}
    ).json()
    public = client.post(
        "/api/collections",
        headers=headers(client),
        json={"name": "Public", "make_public": True},
    ).json()
    owned = {item["id"]: item for item in client.get("/api/collections").json()}
    for capability, expected in {
        "can_edit": True,
        "can_import": True,
        "can_publish": True,
        "can_save": False,
    }.items():
        assert owned[private["id"]][capability] is expected
    assert owned[public["id"]]["can_import"] is True

    account_client("import-capabilities-reader")
    visible = {item["id"]: item for item in client.get("/api/collections").json()}
    assert private["id"] not in visible
    assert visible[public["id"]]["can_edit"] is False
    assert visible[public["id"]]["can_import"] is False
    assert visible[public["id"]]["can_publish"] is False
    assert visible[public["id"]]["can_save"] is True


def test_public_csv_collection_requires_consent_stale_checks_and_is_atomic(
    client, account_client
):
    from uuid import UUID

    from app.models import CollectionEntry, VocabularyEntry

    account_client("public-import-owner")
    before = client.get("/api/collections").json()
    preview = upload(
        client,
        "preview",
        new_name="Shared import",
        source_language="it",
        target_language="el",
        fixed_destination="true",
        make_public="true",
    )
    assert preview.status_code == 200, preview.text
    token = preview.json()["preview_token"]
    assert token
    assert client.get("/api/collections").json() == before

    params = dict(
        new_name="Shared import",
        source_language="it",
        target_language="el",
        fixed_destination="true",
        make_public="true",
        expected_valid=1,
    )
    collection_id = uuid4()
    refused = upload(
        client,
        "confirm",
        new_collection_id=collection_id,
        preview_token=token,
        **params,
    )
    assert refused.status_code == 409
    assert client.get("/api/collections").json() == before

    stale = upload(
        client,
        "confirm",
        csv="italian,greek,word_type\nciao,γεια,expression\narrivedare,φτάνω,verb\n",
        new_collection_id=collection_id,
        preview_token=token,
        confirm_public_exposure="true",
        **params,
    )
    assert stale.status_code == 409
    assert client.get("/api/collections").json() == before

    created = upload(
        client,
        "confirm",
        new_collection_id=collection_id,
        preview_token=token,
        confirm_public_exposure="true",
        **params,
    )
    assert created.status_code == 200, created.text
    collection = next(
        item
        for item in client.get("/api/collections").json()
        if item["id"] == str(collection_id)
    )
    assert collection["visibility"] == "published"
    cards = client.get(f"/api/collections/{collection_id}/entries").json()
    assert len(cards) == 1
    with client.app.state.sessions() as db:
        stored = db.get(VocabularyEntry, UUID(cards[0]["id"]))
        assert stored.visibility == "private"
        assert db.get(
            CollectionEntry, (collection_id, UUID(cards[0]["id"]))
        ).publication_confirmed is True

    invalid = "italian,greek,word_type\nbad,,expression\n"
    invalid_preview = upload(
        client,
        "preview",
        csv=invalid,
        new_name="Rolled back import",
        source_language="it",
        target_language="el",
        fixed_destination="true",
        make_public="true",
    )
    failed = upload(
        client,
        "confirm",
        csv=invalid,
        new_name="Rolled back import",
        source_language="it",
        target_language="el",
        fixed_destination="true",
        make_public="true",
        preview_token=invalid_preview.json()["preview_token"],
        confirm_public_exposure="true",
        expected_valid=1,
    )
    assert failed.status_code == 422
    assert all(
        item["name"] != "Rolled back import"
        for item in client.get("/api/collections").json()
    )


def test_import_into_owned_public_collection_requires_explicit_consent(
    client, account_client
):
    from uuid import UUID

    from app.models import CollectionEntry, VocabularyEntry

    account_client("public-destination-owner")
    public = client.post(
        "/api/collections",
        headers=headers(client),
        json={"name": "Public destination", "make_public": True},
    ).json()
    params = dict(collection_id=public["id"], fixed_destination="true")
    preview = upload(client, "preview", **params)
    assert preview.status_code == 200, preview.text
    token = preview.json()["preview_token"]
    assert client.get(f"/api/collections/{public['id']}/entries").json() == []

    no_consent = upload(
        client,
        "confirm",
        preview_token=token,
        expected_valid=1,
        **params,
    )
    assert no_consent.status_code == 409
    assert client.get(f"/api/collections/{public['id']}/entries").json() == []

    imported = upload(
        client,
        "confirm",
        preview_token=token,
        confirm_public_exposure="true",
        expected_valid=1,
        **params,
    )
    assert imported.status_code == 200, imported.text
    cards = client.get(f"/api/collections/{public['id']}/entries").json()
    assert len(cards) == 1
    with client.app.state.sessions() as db:
        assert db.get(VocabularyEntry, UUID(cards[0]["id"])).visibility == "private"
        assert db.get(
            CollectionEntry, (UUID(public["id"]), UUID(cards[0]["id"]))
        ).publication_confirmed is True

    repeated = upload(
        client,
        "confirm",
        preview_token=token,
        confirm_public_exposure="true",
        expected_valid=0,
        **params,
    )
    assert repeated.status_code == 200
    assert repeated.json()["counts"]["duplicate"] == 1
