"""Danish keeps `common` as a real gender without legacy columns."""

import csv
import io
import json

from conftest import TEST_CSRF, signin
from test_common_card_fields import collection

from app.csv_v2 import (
    decode_grammar,
    decode_grammar_cell,
    encode_grammar,
    grammar_value,
)
from app.grammar import (
    apply_structured_input,
    sync_entry_grammar,
    validate_structured_grammar,
)
from app.models import VocabularyEntry

H = {"X-CSRF-Token": TEST_CSRF}


def test_common_is_only_dropped_when_the_definition_does_not_allow_it():
    assert grammar_value("gender", "common", "da") == "common"
    assert grammar_value("gender", "common", "it") is None
    assert grammar_value("gender", "common") is None
    assert validate_structured_grammar(
        {"da": {"gender": "common", "plural": "huse"}}, ("en", "da"), "noun"
    ) == []
    assert validate_structured_grammar(
        {"da": {"gender": "masculine"}}, ("en", "da"), "noun"
    )


def test_danish_structured_grammar_round_trips_without_a_legacy_column(client):
    client = signin(client)
    owner = collection(client, "en", "da", "Danish grammar")
    response = client.post(
        f"/api/collections/{owner['id']}/cards",
        headers=H,
        json={
            "source_language": "en",
            "target_language": "da",
            "source_text": "house",
            "target_text": "hus",
            "word_type": "noun",
            "grammar": {"da": {"gender": "common", "plural": "huse"}},
        },
    )
    assert response.status_code == 201, response.text
    card = response.json()
    assert card["grammar"]["da"] == {"gender": "common", "plural": "huse"}
    assert not any(field.startswith("danish_") for field in card)

    entry = VocabularyEntry(
        source_language="en",
        target_language="da",
        italian="house",
        greek="hus",
        grammar=card["grammar"],
    )
    assert json.loads(encode_grammar(entry, "da")) == {
        "gender": "common",
        "plural": "huse",
    }
    # Structured-only fields have no legacy column; they live solely in the
    # grammar store, so the compatibility projection is empty for Danish.
    assert decode_grammar(json.dumps({"gender": "common"}), "da") == {}
    assert decode_grammar_cell(json.dumps({"gender": "common"}), "da")[1] == {
        "gender": "common"
    }
    assert decode_grammar(json.dumps({"gender": "common"}), "it") == {}

    errors, structured = apply_structured_input(
        {"grammar": {"da": {"gender": "neuter"}}}, ("en", "da"), "noun", entry
    )
    assert errors == []
    assert structured == {"da": {"gender": "neuter"}}
    sync_entry_grammar(entry, structured)
    assert entry.grammar["da"]["gender"] == "neuter"


def test_danish_example_export_is_pair_scoped(client):
    client = signin(client)
    response = client.get(
        "/api/imports/example",
        params={"source_language": "en", "target_language": "da"},
        headers=H,
    )
    assert response.status_code == 200, response.text
    text = response.content.decode("utf-8-sig")
    rows = list(csv.DictReader(io.StringIO(text)))
    assert rows
    assert set(rows[0]) <= {
        "csv_format",
        "entry_id",
        "collection_id",
        "collection_name",
        "source_language",
        "target_language",
        "card_source_language",
        "card_target_language",
        "text_da",
        "text_en",
        "word_type",
        "grammar_da",
        "grammar_en",
        "tags",
        "notes",
        "unit_code",
        "unit_title",
        "unit_sort_order",
    }
    assert json.loads(rows[0]["grammar_da"])["gender"] == "common"
