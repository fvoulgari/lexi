"""Backend coverage for the multilingual CSV v2 exchange format."""

import csv
import io
import json
from uuid import uuid4

import pytest
from conftest import TEST_CSRF, signin
from test_generic_directions import collection, queue, rate, records

from app.csv_v2 import COLUMNS as V2_COLUMNS
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
    others = {"it", "el", "en", "da", "ja", "ar"} - {source, target}
    assert all(f"text_{language}" not in row for language in others)
    assert all(f"grammar_{language}" not in row for language in others)
    if grammar:
        assert json.loads(row["grammar_it"]) == {
            "gender": "masculine",
            "plural": "ciai",
        }
        assert json.loads(row["grammar_el"])["gender"] == "feminine"
    else:
        assert all(
            not row[f"grammar_{language}"]
            for language in (source, target)
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
