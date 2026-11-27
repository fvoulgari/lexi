"""Common card fields with an optional language-ID-keyed grammar store."""

from conftest import TEST_CSRF
from test_vocabulary_editing import headers

from app.grammar import (
    GRAMMAR_DEFINITIONS,
    GRAMMAR_FIELDS,
    clean_grammar,
    grammar_fields,
    grammar_languages,
    invalid_grammar_fields,
    required_gender_fields,
)
from app.languages import LANGUAGES

H = {"X-CSRF-Token": TEST_CSRF}


def collection(client, source, target, name="Common fields"):
    response = client.post(
        "/api/collections",
        headers=H,
        json={"name": name, "source_language": source, "target_language": target},
    )
    assert response.status_code == 201, response.text
    return response.json()


def card(client, group, word_type="noun", **values):
    response = client.post(
        f"/api/collections/{group['id']}/cards",
        headers=H,
        json={
            "source_language": group["source_language"],
            "target_language": group["target_language"],
            "source_text": "ciao",
            "target_text": "γεια",
            "word_type": word_type,
            **values,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_definitions_cover_legacy_languages_and_optional_danish():
    assert set(GRAMMAR_DEFINITIONS) == {"da", "it", "el"}
    assert grammar_languages(LANGUAGES) == ("da", "it", "el")
    assert grammar_languages(("en", "da")) == ("da",)
    assert grammar_fields(("en", "da")) == ()
    assert required_gender_fields("noun", ("en", "da")) == ()
    assert "neuter" not in GRAMMAR_DEFINITIONS["it"]["genders"]
    assert "neuter" in GRAMMAR_DEFINITIONS["el"]["genders"]
    assert "common" in GRAMMAR_DEFINITIONS["da"]["genders"]

    values = {
        "word_type": "noun",
        "italian_gender": "masculine",
        "greek_gender": "neuter",
    }
    assert all(
        clean_grammar(values, "noun", ("en", "da"))[field] is None
        for field in GRAMMAR_FIELDS
    )
    assert invalid_grammar_fields(
        {"italian_gender": "neuter"}, ("it", "el")
    ) == ["italian_gender"]


def test_legacy_grammar_round_trips_with_the_same_card_id(logged_in):
    client = logged_in
    group = collection(client, "it", "el", "Legacy grammar")
    forms = {
        "italian_masculine_singular": "alto",
        "italian_feminine_singular": "alta",
        "italian_masculine_plural": "alti",
        "italian_feminine_plural": "alte",
        "greek_masculine_singular": "ψηλός",
        "greek_feminine_singular": "ψηλή",
        "greek_neuter_singular": "ψηλό",
    }
    saved = card(
        client,
        group,
        word_type="adjective",
        italian_adjective_gender="masculine",
        greek_adjective_gender="neuter",
        **forms,
    )
    for field, value in {
        "italian_adjective_gender": "masculine",
        "greek_adjective_gender": "neuter",
        **forms,
    }.items():
        assert saved[field] == value

    entry = client.get(f"/api/vocabulary/{saved['id']}").json()
    for field, value in forms.items():
        assert entry[field] == value
    assert entry["italian_adjective_gender"] == "masculine"
    assert entry["greek_adjective_gender"] == "neuter"

    response = client.patch(
        f"/api/vocabulary/{saved['id']}",
        json={"italian_feminine_singular": "alta corretta"},
        headers=headers(client),
    )
    assert response.status_code == 200, response.text
    updated = response.json()["entry"]
    assert updated["id"] == saved["id"]
    assert updated["italian_feminine_singular"] == "alta corretta"
    assert updated["greek_neuter_singular"] == "ψηλό"


def test_common_only_languages_require_no_gender_and_expose_common_fields(logged_in):
    client = logged_in
    group = collection(client, "en", "da", "Common only")
    saved = card(client, group, word_type="noun")
    assert saved["word_type"] == "noun"
    assert not set(saved) & set(GRAMMAR_FIELDS)

    ignored = card(client, group, word_type="noun", italian_gender="masculine")
    assert not set(ignored) & set(GRAMMAR_FIELDS)
    entry = client.get(f"/api/vocabulary/{ignored['id']}").json()
    assert entry["italian_gender"] is None
    assert entry["greek_gender"] is None

    response = client.post(
        f"/api/collections/{group['id']}/cards",
        headers=H,
        json={
            "source_text": "another",
            "target_text": "en anden",
            "word_type": "noun",
            "italian_gender": "masculine",
        },
    )
    assert response.status_code == 201, response.text
    assert not set(response.json()) & set(GRAMMAR_FIELDS)


def test_mixed_pair_validates_only_the_defined_language(logged_in):
    client = logged_in
    group = collection(client, "en", "it", "Mixed pair")
    response = client.post(
        f"/api/collections/{group['id']}/cards",
        headers=H,
        json={
            "source_text": "tall",
            "target_text": "alto",
            "word_type": "noun",
        },
    )
    assert response.status_code == 422
    assert response.json()["error"]["fields"] == ["italian_gender"]

    saved = card(client, group, italian_gender="masculine")
    assert saved["italian_gender"] == "masculine"
    assert "greek_gender" not in saved
    assert "greek_plural" not in saved


def test_common_only_card_ignores_legacy_grammar_on_vocabulary_patch(logged_in):
    client = logged_in
    group = collection(client, "en", "da", "Common patch")
    saved = card(client, group, word_type="noun")
    response = client.patch(
        f"/api/vocabulary/{saved['id']}",
        headers=headers(client),
        json={"notes": "shared note", "italian_gender": "masculine"},
    )
    assert response.status_code == 200, response.text
    updated = response.json()["entry"]
    assert updated["id"] == saved["id"]
    assert updated["notes"] == "shared note"
    assert updated["italian_gender"] is None
    assert updated["greek_gender"] is None


def test_card_language_ids_cannot_be_changed_after_creation(logged_in):
    client = logged_in
    legacy = client.post(
        "/api/vocabulary",
        headers=headers(client),
        json={
            "visibility": "private",
            "collection_id": client.get("/api/collections").json()[0]["id"],
            "italian": "il biglietto",
            "greek": "το εισιτήριο",
            "word_type": "noun",
            "italian_gender": "masculine",
            "greek_gender": "neuter",
        },
    ).json()["entry"]
    response = client.patch(
        f"/api/vocabulary/{legacy['id']}",
        headers=headers(client),
        json={"source_language": "en", "target_language": "da"},
    )
    assert response.status_code == 422
    assert "cannot be changed" in response.json()["error"]["message"]
    unchanged = client.get(f"/api/vocabulary/{legacy['id']}").json()
    assert (unchanged["source_language"], unchanged["target_language"]) == ("it", "el")

    group = collection(client, "en", "da", "Immutable IDs")
    saved = card(client, group)
    response = client.patch(
        f"/api/collections/cards/{saved['id']}",
        headers=H,
        json={
            "source_language": "it",
            "target_language": "el",
            "source_text": "ciao",
            "target_text": "γεια",
        },
    )
    assert response.status_code == 422
    assert "cannot be changed" in response.json()["error"]["message"]
    unchanged = client.get(f"/api/vocabulary/{saved['id']}").json()
    assert (unchanged["source_language"], unchanged["target_language"]) == ("da", "en")
