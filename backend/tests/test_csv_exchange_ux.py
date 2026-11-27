"""Automatic CSV detection, compact templates and representation exports."""

import csv
import io
import json

import pytest
from fastapi import HTTPException
from test_csv_v2 import make_card, send
from test_generic_directions import H, collection

from app.csv_format import (
    FORMAT_VERSION,
    FORMAT_VERSION_SIMPLE,
    FORMAT_VERSION_V2,
    FORMAT_VERSION_V3,
)
from app.csv_v2 import template_columns
from app.grammar import DEFINITIONS
from app.imports import detect_format


def csv_bytes(rows):
    output = io.StringIO(newline="")
    writer = csv.writer(output)
    writer.writerows(rows)
    return output.getvalue().encode("utf-8-sig")


def rows_of(content):
    return list(csv.DictReader(io.StringIO(content.decode("utf-8-sig"))))


def rejection(call, fragment):
    with pytest.raises(HTTPException) as failure:
        call()
    assert failure.value.status_code == 422
    assert fragment in failure.value.detail["message"]


@pytest.mark.parametrize(
    "fields,versions,expected",
    [
        (
            ["csv_format", "base", "learning", "word_type", "notes", "tags"],
            [FORMAT_VERSION_SIMPLE],
            FORMAT_VERSION_SIMPLE,
        ),
        (template_columns(("en", "da")), [FORMAT_VERSION_V2], FORMAT_VERSION_V2),
        (template_columns(("en", "da")), [""], FORMAT_VERSION_V2),
        (
            ["csv_format", "italian", "greek", "word_type", "tags"],
            [FORMAT_VERSION],
            FORMAT_VERSION,
        ),
        (["csv_format", "italian", "greek", "word_type", "tags"], [""], ""),
        (
            [
                "csv_format",
                "card_source_language",
                "card_target_language",
                "text_en",
                "text_da",
                "word_type",
                "grammar_da",
                "schema_version",
                "metadata",
            ],
            [""],
            FORMAT_VERSION_V3,
        ),
    ],
)
def test_detect_format_recognizes_templates_aliases_and_legacy_rows(
    fields, versions, expected
):
    assert detect_format(fields, versions) == expected


def test_detect_format_rejects_conflicting_or_lossy_identifiers():
    rejection(
        lambda: detect_format(
            template_columns(("en", "da")),
            [FORMAT_VERSION_V2, FORMAT_VERSION_V3],
        ),
        "conflicting format identifiers",
    )
    rejection(
        lambda: detect_format(["base", "word_type"], [FORMAT_VERSION_SIMPLE]),
        "base and learning",
    )
    rejection(
        lambda: detect_format(
            ["csv_format", "word_type", "text_en", "text_da", "schema_version"],
            [FORMAT_VERSION_V2],
        ),
        "no grammar information is discarded",
    )
    rejection(
        lambda: detect_format(["csv_format", "type"], [FORMAT_VERSION]),
        "Legacy templates need italian and greek",
    )
    rejection(
        lambda: detect_format(["notes", "type"], [""]),
        "could not identify the language columns",
    )


@pytest.mark.parametrize(
    "source,target,expected",
    [
        (
            "el",
            "it",
            (
                "csv_format",
                "card_source_language",
                "card_target_language",
                "text_el",
                "text_it",
                "word_type",
                "grammar_it",
                "grammar_el",
                "notes",
                "tags",
            ),
        ),
        (
            "en",
            "da",
            (
                "csv_format",
                "card_source_language",
                "card_target_language",
                "text_en",
                "text_da",
                "word_type",
                "grammar_da",
                "notes",
                "tags",
            ),
        ),
        (
            "ja",
            "ar",
            (
                "csv_format",
                "card_source_language",
                "card_target_language",
                "text_ja",
                "text_ar",
                "word_type",
                "notes",
                "tags",
            ),
        ),
    ],
)
def test_template_is_generated_from_the_selected_languages(
    logged_in, source, target, expected
):
    response = logged_in.get(
        "/api/imports/example",
        params={
            "format": "template",
            "source_language": source,
            "target_language": target,
        },
        headers=H,
    )
    assert response.status_code == 200, response.text
    rows = rows_of(response.content)
    assert list(rows[0]) == list(expected)
    assert rows[0]["csv_format"] == FORMAT_VERSION_V2
    assert rows[0]["card_source_language"] == source
    assert rows[0]["card_target_language"] == target


def test_generated_template_imports_without_a_version_or_mapping_choice(logged_in):
    owner = collection(logged_in, "ja", "en", "Template import")
    template = logged_in.get(
        "/api/imports/example",
        params={"collection_id": owner["id"], "format": "template"},
        headers=H,
    )
    assert template.status_code == 200, template.text
    report = send(
        logged_in,
        "preview",
        template.content,
        collection_id=owner["id"],
        fixed_destination="true",
    )
    assert report.status_code == 200, report.text
    assert report.json()["counts"] == {
        "imported": 0,
        "updated": 0,
        "valid": 3,
        "skipped": 0,
        "duplicate": 0,
        "error": 0,
    }


def test_ambiguous_headers_import_after_an_explicit_mapping(logged_in):
    owner = collection(logged_in, "el", "it", "Mapped import")
    content = csv_bytes(
        [["word", "translation", "part"], ["γεια", "ciao", "expression"]]
    )
    blocked = send(
        logged_in,
        "preview",
        content,
        collection_id=owner["id"],
        fixed_destination="true",
    )
    assert blocked.status_code == 422
    assert "Map or ignore them" in blocked.text

    mapping = {"word": "text_el", "translation": "text_it", "part": "word_type"}
    report = send(
        logged_in,
        "preview",
        content,
        collection_id=owner["id"],
        fixed_destination="true",
        column_mapping=json.dumps(mapping),
    )
    assert report.status_code == 200, report.text
    assert report.json()["counts"]["valid"] == 1
    assert report.json()["counts"]["error"] == 0
    result = send(
        logged_in,
        "confirm",
        content,
        collection_id=owner["id"],
        fixed_destination="true",
        expected_valid=1,
        column_mapping=json.dumps(mapping),
    )
    assert result.status_code == 200, result.text
    assert result.json()["counts"]["imported"] == 1
    members = logged_in.get(f"/api/collections/{owner['id']}/entries").json()
    card = logged_in.get(f"/api/vocabulary/{members[0]['id']}").json()
    assert (card["italian"], card["greek"]) == ("ciao", "γεια")
    assert (card["source_language"], card["target_language"]) == ("it", "el")


def test_export_representations_round_trip_language_ids_and_grammar(logged_in):
    owner = collection(logged_in, "en", "da", "Representation source")
    grammar = {
        "da": {
            "gender": "common",
            "plural": "huse",
            "example": "Huset er stort.",
        }
    }
    make_card(
        logged_in,
        owner,
        "da",
        "en",
        "hus — hjem",
        "house",
        word_type="noun",
        grammar=grammar,
    )

    vocabulary = logged_in.get(
        "/api/vocabulary/export.csv",
        params={"collection_id": owner["id"], "representation": "vocabulary"},
    )
    assert vocabulary.status_code == 200, vocabulary.text
    vocab_rows = rows_of(vocabulary.content)
    assert list(vocab_rows[0]) == [
        "csv_format",
        "card_source_language",
        "card_target_language",
        "text_da",
        "text_en",
        "word_type",
        "notes",
        "tags",
    ]
    assert vocab_rows[0]["csv_format"] == FORMAT_VERSION_V2

    metadata = logged_in.get(
        "/api/vocabulary/export.csv",
        params={"collection_id": owner["id"], "representation": "metadata"},
    )
    assert metadata.status_code == 200, metadata.text
    meta_rows = rows_of(metadata.content)
    assert "grammar_da" in meta_rows[0]
    assert "schema_version" in meta_rows[0]
    assert "metadata" in meta_rows[0]
    assert meta_rows[0]["csv_format"] == FORMAT_VERSION_V3
    assert meta_rows[0]["schema_version"] == str(DEFINITIONS["version"])
    assert meta_rows[0]["card_source_language"] == "da"
    assert meta_rows[0]["card_target_language"] == "en"
    assert json.loads(meta_rows[0]["grammar_da"]) == grammar["da"]
    assert json.loads(meta_rows[0]["metadata"]) == {"grammar": grammar}

    for label, exported, header in (
        ("Vocabulary import", vocab_rows[0], list(vocab_rows[0])),
        ("Metadata import", meta_rows[0], list(meta_rows[0])),
    ):
        destination = collection(logged_in, "en", "da", label)
        imported = dict(
            exported,
            entry_id="",
            collection_id="",
            collection_name="",
            text_da="huse",
            text_en="home",
        )
        content = csv_bytes([header, [imported[column] for column in header]])
        report = send(
            logged_in,
            "preview",
            content,
            collection_id=destination["id"],
            fixed_destination="true",
        )
        assert report.status_code == 200, report.text
        assert report.json()["counts"]["valid"] == 1
        assert report.json()["counts"]["error"] == 0
        result = send(
            logged_in,
            "confirm",
            content,
            collection_id=destination["id"],
            fixed_destination="true",
            expected_valid=1,
        )
        assert result.status_code == 200, result.text
        members = logged_in.get(f"/api/collections/{destination['id']}/entries").json()
        card = logged_in.get(f"/api/vocabulary/{members[0]['id']}").json()
        assert (card["source_language"], card["target_language"]) == ("da", "en")
        assert (card["italian"], card["greek"]) == ("huse", "home")
        assert (card.get("grammar") or {}).get("da") == (
            grammar["da"] if label == "Metadata import" else None
        )


def test_export_rejects_mixing_representations_with_versions(logged_in):
    owner = collection(logged_in, "en", "da", "Representation guard")
    response = logged_in.get(
        "/api/vocabulary/export.csv",
        params={
            "collection_id": owner["id"],
            "format": "v2",
            "representation": "vocabulary",
        },
    )
    assert response.status_code == 422
    assert "not a CSV version" in response.text
