"""Backend coverage for the multilingual CSV v2 exchange format."""

import csv
import io
import json
from uuid import uuid4

import pytest
from conftest import TEST_CSRF, signin
from test_generic_directions import collection, queue, rate, records

from app.csv_v2 import COLUMNS as V2_COLUMNS
from app.csv_v2 import v2_columns, v3_columns
from app.grammar import DEFINITIONS
from app.languages import direction_key

H = {"X-CSRF-Token": TEST_CSRF}


@pytest.fixture
def client(client):
    """These CSV flows need a signed-in client; the base fixture is anonymous."""
    return signin(client)


PAIRS = [
    ("it", "el", "ciao", "γεια"),
    ("en", "da", "hello", "hej"),
    ("en", "el", "hello", "γεια"),
    ("ja", "en", "日本語", "Japanese"),
    ("ar", "en", "العربية", "Arabic"),
    ("ja", "ar", "こんにちは", "مرحبا"),
]


def make_card(client, owner, source, target, source_text, target_text, **grammar):
    response = client.post(
        f"/api/collections/{owner['id']}/cards",
        headers=H,
        json={
            "source_language": source,
            "target_language": target,
            "source_text": source_text,
            "target_text": target_text,
            **grammar,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def v2_csv(rows, columns=V2_COLUMNS):
    output = io.StringIO(newline="")
    writer = csv.writer(output)
    writer.writerow(columns)
    for row in rows:
        writer.writerow(row.get(column, "") for column in columns)
    return output.getvalue().encode("utf-8-sig")


def exported(client, collection_id):
    response = client.get(
        "/api/vocabulary/export.csv",
        params={"collection_id": str(collection_id), "include_ids": "true"},
    )
    assert response.status_code == 200, response.text
    assert response.content.startswith(b"\xef\xbb\xbf")
    reader = csv.DictReader(io.StringIO(response.content.decode("utf-8-sig")))
    return response, list(reader)


def send(client, action, content, **params):
    return client.post(
        f"/api/imports/{action}",
        params=params,
        headers={**H, "Content-Type": "text/csv"},
        content=content,
    )


@pytest.mark.parametrize("source,target,source_text,target_text", PAIRS)
def test_v2_export_uses_language_keyed_columns_for_every_collection(
    client, source, target, source_text, target_text
):
    owner = collection(client, source, target, "V2 export")
    grammar = (
        {
            "word_type": "noun",
            "italian_gender": "masculine",
            "greek_gender": "feminine",
            "italian_plural": "ciai",
        }
        if {source, target} == {"it", "el"}
        else {}
    )
    entry = make_card(
        client, owner, source, target, source_text, target_text, **grammar
    )
    response, rows = exported(client, owner["id"])
    assert len(rows) == 1
    row = rows[0]
    assert row["csv_format"] == "italian-notebook-v2"
    assert row["collection_id"] == owner["id"]
    assert row["entry_id"] == entry["id"]
    assert row["source_language"] == owner["source_language"]
    assert row["target_language"] == owner["target_language"]
    assert row["card_source_language"] == entry["source_language"]
    assert row["card_target_language"] == entry["target_language"]
    assert row[f"text_{source}"] == source_text
    assert row[f"text_{target}"] == target_text
    # A collection export is scoped to its own pair, not the whole registry.
    assert set(row) == set(v2_columns(sorted((source, target))))
    if grammar:
        assert json.loads(row["grammar_it"]) == {
            "gender": "masculine",
            "plural": "ciai",
        }
        assert json.loads(row["grammar_el"])["gender"] == "feminine"
    else:
        assert all(
            not row[f"grammar_{language}"]
            for language in ("it", "el", "en", "da")
            if f"grammar_{language}" in row
        )


@pytest.mark.parametrize("source,target,source_text,target_text", PAIRS)
def test_v2_round_trip_preserves_identity_progress_and_reversed_membership(
    client, account_client, source, target, source_text, target_text
):
    learner = account_client(f"v2-{source}-{target}")
    owner = collection(client, source, target, "V2 source")
    entry = make_card(client, owner, source, target, source_text, target_text)
    direction = direction_key(source, target)
    session = queue(client, learner, [owner], direction)
    rate(client, session, entry["id"], direction, "hard")
    before = records(client, learner["profile_id"])
    _, rows = exported(client, owner["id"])
    content = v2_csv(rows)

    for action in ("preview", "confirm"):
        response = send(
            client,
            action,
            content,
            collection_id=owner["id"],
            fixed_destination="true",
        )
        assert response.status_code == 200, response.text
        assert response.json()["counts"]["duplicate"] == 1
        assert response.json()["counts"]["error"] == 0
    assert records(client, learner["profile_id"]) == before

    reversed_collection = collection(client, target, source, "V2 reversed")
    added = send(
        client,
        "confirm",
        content,
        collection_id=reversed_collection["id"],
        fixed_destination="true",
        expected_valid=1,
    )
    assert added.status_code == 200, added.text
    assert added.json()["counts"]["updated"] == 1
    members = client.get(
        f"/api/collections/{reversed_collection['id']}/entries"
    ).json()
    assert [member["id"] for member in members] == [entry["id"]]
    assert records(client, learner["profile_id"]) == before

    # A new text without an entry_id creates a distinct card with the language
    # IDs carried by the CSV, never inferred from column position.
    without_id = dict(
        rows[0],
        entry_id="",
        **{
            f"text_{source}": f"{source_text} new",
            f"text_{target}": f"{target_text} new",
        },
    )
    created = send(
        client,
        "confirm",
        v2_csv([without_id]),
        collection_id=reversed_collection["id"],
        fixed_destination="true",
    )
    assert created.status_code == 200, created.text
    assert created.json()["counts"]["imported"] == 1
    members = client.get(
        f"/api/collections/{reversed_collection['id']}/entries"
    ).json()
    fresh = next(member for member in members if member["id"] != entry["id"])
    assert {fresh["source_language"], fresh["target_language"]} == {source, target}
    expected = {
        source: f"{source_text} new",
        target: f"{target_text} new",
    }
    assert {
        fresh["source_language"]: fresh["source_text"],
        fresh["target_language"]: fresh["target_text"],
    } == expected


def test_v2_reversed_legacy_card_ids_keep_text_with_its_language(client):
    owner = collection(client, "it", "el", "Reversed card IDs")
    row = {
        "csv_format": "italian-notebook-v2",
        "source_language": "it",
        "target_language": "el",
        "card_source_language": "el",
        "card_target_language": "it",
        "text_el": "γεια",
        "text_it": "ciao",
        "word_type": "noun",
        "grammar_it": json.dumps({"gender": "masculine"}),
        "grammar_el": json.dumps({"gender": "feminine"}),
        "tags": "[]",
    }
    content = v2_csv([row], v2_columns(sorted(("it", "el"))))
    report = send(
        client,
        "preview",
        content,
        collection_id=owner["id"],
        fixed_destination="true",
    )
    assert report.status_code == 200, report.text
    assert report.json()["counts"]["error"] == 0
    result = send(
        client,
        "confirm",
        content,
        collection_id=owner["id"],
        fixed_destination="true",
        expected_valid=1,
    )
    assert result.status_code == 200, result.text
    members = client.get(f"/api/collections/{owner['id']}/entries").json()
    assert len(members) == 1
    card = client.get(f"/api/vocabulary/{members[0]['id']}").json()
    assert (card["source_language"], card["italian"]) == ("it", "ciao")
    assert (card["target_language"], card["greek"]) == ("el", "γεια")


def test_v2_import_creates_non_legacy_collection_destination(client):
    owner = collection(client, "en", "da", "V2 origins")
    entry = make_card(client, owner, "en", "da", "hello", "hej")
    _, rows = exported(client, owner["id"])
    content = v2_csv(rows)
    name = "V2 imported collection"
    preview = send(
        client,
        "preview",
        content,
        new_name=name,
        source_language="en",
        target_language="da",
    )
    assert preview.status_code == 200, preview.text
    assert preview.json()["counts"]["valid"] == 1
    confirmed = send(
        client,
        "confirm",
        content,
        new_name=name,
        source_language="en",
        target_language="da",
        new_collection_id=str(uuid4()),
        expected_valid=1,
    )
    assert confirmed.status_code == 200, confirmed.text
    created = confirmed.json()["destination_collection"]
    assert {c["name"] for c in client.get("/api/collections").json()} >= {name}
    assert client.get(f"/api/collections/{created['id']}/entries").json()[0]["id"] == (
        entry["id"]
    )


@pytest.mark.parametrize(
    "change,fragment,columns",
    [
        ({"text_da": ""}, "Missing text for da", V2_COLUMNS),
        (
            {"card_source_language": "it", "card_target_language": "el"},
            "Card language pair does not match",
            V2_COLUMNS,
        ),
        (
            {"source_language": "it", "target_language": "el"},
            "Collection languages do not match",
            V2_COLUMNS,
        ),
        (
            {"csv_format": "italian-notebook-v99"},
            "Unsupported csv_format",
            V2_COLUMNS,
        ),
        (
            {"gender": "masculine"},
            "Legacy aliases cannot be used",
            (*V2_COLUMNS, "gender"),
        ),
        (
            {"grammar_en": '{"gender": "masculine"}'},
            "No grammar definition for en",
            V2_COLUMNS,
        ),
        (
            {"grammar_it": '{"typo": "masculine"}'},
            "Unknown grammar field",
            V2_COLUMNS,
        ),
    ],
)
def test_v2_row_errors_are_reported_in_preview(client, change, fragment, columns):
    owner = collection(client, "en", "da", "V2 errors")
    make_card(client, owner, "en", "da", "hello", "hej")
    _, rows = exported(client, owner["id"])
    report = send(
        client,
        "preview",
        v2_csv([dict(rows[0], **change)], columns),
        collection_id=owner["id"],
        fixed_destination="true",
    )
    assert report.status_code == 200, report.text
    result = report.json()
    assert result["counts"]["error"] == 1
    assert fragment in result["rows"][0]["errors"][0]


def test_legacy_rows_into_non_legacy_collection_are_row_errors(client):
    owner = collection(client, "en", "da", "V2 legacy guard")
    content = (
        b"italian,greek,word_type\n"
        b"ciao,\xce\xb3\xce\xb5\xce\xb9\xce\xb1,expression\n"
    )
    report = send(
        client,
        "preview",
        content,
        collection_id=owner["id"],
        fixed_destination="true",
    )
    assert report.status_code == 200, report.text
    result = report.json()
    assert result["counts"]["error"] == 1
    assert "Italian–Greek Collection" in result["rows"][0]["errors"][0]


def test_v1_export_still_available_for_legacy_collections(client):
    owner = collection(client, "it", "el", "V1 export")
    make_card(client, owner, "it", "el", "ciao", "γεια")
    response = client.get(
        "/api/vocabulary/export.csv",
        params={"collection_id": str(owner["id"]), "format": "v1"},
    )
    assert response.status_code == 200, response.text
    rows = list(csv.DictReader(io.StringIO(response.content.decode("utf-8-sig"))))
    assert rows[0]["csv_format"] == "italian-notebook-v1"
    assert (rows[0]["italian"], rows[0]["greek"]) == ("ciao", "γεια")


def test_v2_preserves_formula_safety_unicode_and_row_limits(client):
    owner = collection(client, "en", "da", "V2 safety")
    source_text = "=1+1"
    target_text = "hej — καλημέρα"
    entry = make_card(client, owner, "en", "da", source_text, target_text)
    response, rows = exported(client, owner["id"])
    assert "'=1+1" in response.content.decode("utf-8-sig")
    assert "hej — καλημέρα" in response.content.decode("utf-8-sig")
    content = v2_csv(rows)
    report = send(
        client,
        "preview",
        content,
        collection_id=owner["id"],
        fixed_destination="true",
    )
    assert report.status_code == 200, report.text
    assert report.json()["counts"]["duplicate"] == 1
    assert client.get(f"/api/vocabulary/{entry['id']}").json()["italian"] == source_text
    too_many = v2_csv([rows[0]] * 2001)
    assert send(
        client,
        "preview",
        too_many,
        collection_id=owner["id"],
        fixed_destination="true",
    ).status_code == 422


def test_v3_export_import_is_lossless_for_structured_grammar_and_text(client):
    owner = collection(client, "en", "da", "V3 export")
    grammar = {
        "da": {
            "gender": "common",
            "plural": "huse",
            "example": "Huset er stort.",
        }
    }
    make_card(
        client,
        owner,
        "en",
        "da",
        "=1+1",
        "hus — hjem",
        word_type="noun",
        grammar=grammar,
    )
    response = client.get(
        "/api/vocabulary/export.csv",
        params={"collection_id": owner["id"], "format": "v3"},
    )
    assert response.status_code == 200, response.text
    assert response.content.startswith(b"\xef\xbb\xbf")
    rows = list(csv.DictReader(io.StringIO(response.content.decode("utf-8-sig"))))
    assert len(rows) == 1
    row = rows[0]
    assert set(row) == set(v3_columns(sorted(("en", "da"))))
    assert row["csv_format"] == "italian-notebook-v3"
    assert row["schema_version"] == str(DEFINITIONS["version"])
    assert row["text_en"] == "'=1+1"
    assert row["text_da"] == "hus — hjem"
    assert json.loads(row["metadata"]) == {"grammar": grammar}

    destination = collection(client, "en", "da", "V3 import")
    imported = dict(
        row,
        entry_id="",
        collection_id="",
        collection_name="",
        text_en="=2+2",
        text_da="huse",
    )
    content = v2_csv([imported], v3_columns(sorted(("en", "da"))))
    report = send(
        client,
        "preview",
        content,
        collection_id=destination["id"],
        fixed_destination="true",
    )
    assert report.status_code == 200, report.text
    assert report.json()["counts"]["valid"] == 1
    assert report.json()["counts"]["error"] == 0
    assert report.json()["rows"][0]["entry"]["grammar"] == grammar
    result = send(
        client,
        "confirm",
        content,
        collection_id=destination["id"],
        fixed_destination="true",
        expected_valid=1,
    )
    assert result.status_code == 200, result.text
    assert result.json()["counts"]["imported"] == 1
    members = client.get(
        f"/api/collections/{destination['id']}/entries"
    ).json()
    assert len(members) == 1
    card = client.get(f"/api/vocabulary/{members[0]['id']}").json()
    assert card["italian"] == "=2+2"
    assert card["greek"] == "huse"
    assert card["grammar"]["da"] == grammar["da"]


def test_v3_rejects_unsupported_versions_and_metadata_without_partial_writes(client):
    owner = collection(client, "en", "da", "V3 guards")
    columns = v3_columns(sorted(("en", "da")))
    base = {
        "csv_format": "italian-notebook-v3",
        "card_source_language": "en",
        "card_target_language": "da",
        "text_en": "house",
        "text_da": "hus",
        "word_type": "noun",
        "tags": "[]",
        "schema_version": str(DEFINITIONS["version"]),
        "metadata": json.dumps({"grammar": {"da": {"gender": "common"}}}),
    }
    cases = [
        ({}, "schema_version", "999", "schema version"),
        ({}, "metadata", '{"extra": 1}', "Unsupported metadata"),
        ({}, "metadata", "not json", "metadata must be a JSON object"),
        (
            {"metadata": ""},
            "metadata",
            json.dumps({"grammar": {"da": {"gender": "masculine"}}}),
            "gender",
        ),
        (
            {"grammar_da": json.dumps({"gender": "neuter"})},
            "metadata",
            json.dumps({"grammar": {"da": {"gender": "common"}}}),
            "conflicts with metadata",
        ),
    ]
    for changes, field, value, fragment in cases:
        row = {**base, **changes}
        row[field] = value
        report = send(
            client,
            "preview",
            v2_csv([row], columns),
            collection_id=owner["id"],
            fixed_destination="true",
        )
        assert report.status_code == 200, report.text
        result = report.json()
        assert result["counts"]["error"] == 1
        assert fragment in result["rows"][0]["errors"][0]
        assert result["counts"]["imported"] == 0
    assert client.get(f"/api/collections/{owner['id']}/entries").json() == []


def test_simple_template_is_discoverable_and_imports_base_learning_columns(client):
    owner = collection(client, "en", "da", "Simple import")
    response = client.get(
        "/api/imports/example",
        params={"collection_id": owner["id"], "format": "simple"},
        headers=H,
    )
    assert response.status_code == 200, response.text
    assert response.content.startswith(b"\xef\xbb\xbf")
    rows = list(csv.DictReader(io.StringIO(response.content.decode("utf-8-sig"))))
    assert list(rows[0]) == [
        "csv_format",
        "base",
        "learning",
        "word_type",
        "notes",
        "tags",
    ]
    assert {row["csv_format"] for row in rows} == {"lexi-simple-v1"}
    assert (rows[0]["base"], rows[0]["learning"]) == ("hus", "house")

    report = send(
        client,
        "preview",
        response.content,
        collection_id=owner["id"],
        fixed_destination="true",
    )
    assert report.status_code == 200, report.text
    assert report.json()["counts"]["valid"] == 3
    assert report.json()["counts"]["error"] == 0
    result = send(
        client,
        "confirm",
        response.content,
        collection_id=owner["id"],
        fixed_destination="true",
        expected_valid=3,
    )
    assert result.status_code == 200, result.text
    assert result.json()["counts"]["imported"] == 3
    members = client.get(f"/api/collections/{owner['id']}/entries").json()
    cards = [client.get(f"/api/vocabulary/{member['id']}").json() for member in members]
    # The collection stores its pair unordered; Base/Learning texts stay in the
    # destination's canonical order so the same simple file works either way.
    assert [(card["italian"], card["greek"]) for card in cards] == [
        ("hus", "house"),
        ("tale", "speak"),
        ("smuk", "beautiful"),
    ]
