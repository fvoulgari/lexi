"""One schema-driven authoring payload for every curated Collection pair."""

from uuid import uuid4

from test_common_card_fields import H, collection
from test_shareable_collections import publish, session

from app.languages import card_text


def theme(client, name="A theme", visibility="private"):
    response = client.post(
        "/api/tags", headers=H, json={"name": name, "visibility": visibility}
    )
    assert response.status_code == 201, response.text
    return response.json()


def create(client, group, **body):
    response = client.post(
        f"/api/collections/{group['id']}/cards",
        headers=H,
        json={
            "source_text": "house",
            "target_text": "hus",
            "word_type": "expression",
            **body,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_all_common_fields_round_trip_for_a_universal_pair(logged_in):
    client = logged_in
    group = collection(client, "en", "da", "Universal")
    tag = theme(client, "Everyday")
    saved = create(
        client,
        group,
        notes="Use this one often",
        tag_ids=[tag["id"]],
        word_type="verb",
    )
    assert saved["notes"] == "Use this one often"
    assert [item["id"] for item in saved["tags"]] == [tag["id"]]
    assert saved["word_type"] == "verb"
    assert saved["grammar"] is None
    assert not any(
        field in saved
        for field in ("italian_gender", "greek_gender", "italian_example")
    )

    response = client.patch(
        f"/api/collections/cards/{saved['id']}",
        headers=H,
        json={
            "notes": "Updated note",
            "tag_ids": [],
            "source_text": "home",
            "target_text": "hjem",
            "word_type": "expression",
        },
    )
    assert response.status_code == 200, response.text
    updated = response.json()
    assert updated["id"] == saved["id"]
    assert updated["notes"] == "Updated note"
    assert updated["tags"] == []
    assert updated["source_text"] == "home"
    assert updated["target_text"] == "hjem"
    assert updated["word_type"] == "expression"
    assert (updated["source_language"], updated["target_language"]) == ("da", "en")

    entries = client.get(f"/api/collections/{group['id']}/entries").json()
    assert [e["notes"] for e in entries] == ["Updated note"]
    vocabulary = client.get(f"/api/vocabulary/{saved['id']}").json()
    assert vocabulary["notes"] == "Updated note"

    response = client.patch(
        f"/api/collections/cards/{saved['id']}",
        headers=H,
        json={"source_text": "home", "target_text": "hjem", "notes": None},
    )
    assert response.status_code == 200, response.text
    assert response.json()["notes"] is None


def test_structured_grammar_and_common_fields_edit_together(logged_in):
    client = logged_in
    group = collection(client, "en", "it", "Mixed authoring")
    tag = theme(client, "Travel")
    saved = create(
        client,
        group,
        notes="A house",
        tag_ids=[tag["id"]],
        source_text="house",
        target_text="casa",
        word_type="noun",
        grammar={"it": {"gender": "feminine", "example": "La casa è grande."}},
    )
    assert saved["grammar"] == {
        "it": {"gender": "feminine", "example": "La casa è grande."}
    }
    assert saved["italian_gender"] == "feminine"
    assert "greek_gender" not in saved
    assert [item["id"] for item in saved["tags"]] == [tag["id"]]

    response = client.patch(
        f"/api/collections/cards/{saved['id']}",
        headers=H,
        json={
            "source_text": "house",
            "target_text": "casa",
            "word_type": "noun",
            "grammar": {"it": {"gender": "masculine", "pronunciation": "ˈkaza"}},
            "notes": "Updated",
            "tag_ids": [],
        },
    )
    assert response.status_code == 200, response.text
    updated = response.json()
    assert updated["grammar"]["it"] == {
        "gender": "masculine",
        "example": "La casa è grande.",
        "pronunciation": "ˈkaza",
    }
    assert updated["notes"] == "Updated"
    assert updated["tags"] == []
    assert (updated["source_language"], updated["target_language"]) == ("en", "it")


def test_authoring_preserves_explicit_language_identity_for_reversed_pairs(logged_in):
    client = logged_in
    group = collection(client, "da", "el", "Reversed")
    saved = create(
        client,
        group,
        source_language="el",
        target_language="da",
        source_text="σπίτι",
        target_text="hus",
    )
    assert (saved["source_language"], saved["target_language"]) == ("el", "da")
    assert (saved["source_text"], saved["target_text"]) == ("σπίτι", "hus")
    changed = client.patch(
        f"/api/collections/cards/{saved['id']}",
        headers=H,
        json={
            "source_language": "da",
            "target_language": "el",
            "source_text": "σπίτι",
            "target_text": "hus",
        },
    )
    assert changed.status_code == 422
    assert "cannot be changed" in changed.json()["error"]["message"]


def test_card_themes_validate_existence_and_library_scope(logged_in, account_client):
    client = logged_in
    group = collection(client, "en", "da", "Theme validation")
    missing = client.post(
        f"/api/collections/{group['id']}/cards",
        headers=H,
        json={
            "source_text": "one",
            "target_text": "en",
            "word_type": "expression",
            "tag_ids": [str(uuid4())],
        },
    )
    assert missing.status_code == 422
    assert missing.json()["error"]["fields"] == ["tag_ids"]

    tag = theme(client, "Owner theme")
    saved = create(client, group, tag_ids=[tag["id"]])
    account_client("other-theme-owner")
    foreign_tag = theme(client, "Foreign theme")
    account_client("test-admin")
    cross_scope = client.patch(
        f"/api/collections/cards/{saved['id']}",
        headers=H,
        json={
            "source_text": "house",
            "target_text": "hus",
            "word_type": "expression",
            "tag_ids": [foreign_tag["id"]],
        },
    )
    assert cross_scope.status_code == 422
    assert cross_scope.json()["error"]["fields"] == ["tag_ids"]
    unchanged = client.get(f"/api/vocabulary/{saved['id']}").json()
    assert [item["id"] for item in unchanged["tags"]] == [tag["id"]]


def test_authored_fields_respect_collection_write_permissions(
    logged_in, account_client
):
    client = logged_in
    group = collection(client, "en", "da", "Permissions")
    tag = theme(client, "Owner theme")
    saved = create(client, group, notes="private", tag_ids=[tag["id"]])

    account_client("card-reader", role="learner")
    denied = client.patch(
        f"/api/collections/cards/{saved['id']}",
        headers=H,
        json={
            "source_text": "stolen",
            "target_text": "stolen",
            "word_type": "expression",
            "notes": "stolen",
            "tag_ids": [],
        },
    )
    assert denied.status_code in (403, 404)
    account_client("test-admin")
    untouched = client.get(f"/api/vocabulary/{saved['id']}").json()
    assert untouched["notes"] == "private"
    assert [item["id"] for item in untouched["tags"]] == [tag["id"]]


def test_schema_edit_updates_review_snapshot_and_keeps_membership(
    logged_in, account_client
):
    client = logged_in
    group = collection(client, "en", "da", "Reviewed")
    tag = theme(client, "Focus")
    saved = create(
        client,
        group,
        source_text="house",
        target_text="hus",
        notes="before",
        tag_ids=[tag["id"]],
    )
    assert publish(client, group).status_code == 200

    learner = account_client("schema-reviewer", role="editor")
    first = session(client, learner, [group], direction="en_to_da")
    assert first.status_code == 201, first.text
    snapshot = first.json()["cards"][0]["snapshot"]
    assert snapshot["notes"] == "before"
    # Private themes stay redacted for the reviewing learner.
    assert snapshot["tags"] == []

    account_client("test-admin")
    updated = client.patch(
        f"/api/collections/cards/{saved['id']}",
        headers=H,
        json={
            "source_text": "home",
            "target_text": "hjem",
            "word_type": "expression",
            "notes": "after",
            "tag_ids": [],
        },
    )
    assert updated.status_code == 200, updated.text

    learner = account_client("schema-reviewer", role="editor")
    second = session(client, learner, [group], direction="en_to_da")
    assert second.status_code == 201, second.text
    snapshot = second.json()["cards"][0]["snapshot"]
    assert snapshot["notes"] == "after"
    assert snapshot["tags"] == []
    source, target = snapshot["source_language"], snapshot["target_language"]
    assert {card_text(snapshot, source), card_text(snapshot, target)} == {
        "home",
        "hjem",
    }
    entries = client.get(f"/api/collections/{group['id']}/entries").json()
    assert [entry["id"] for entry in entries] == [saved["id"]]
