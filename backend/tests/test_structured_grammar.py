"""Configuration-driven grammar definitions and one structured grammar store."""

from pathlib import Path
from uuid import uuid4

import pytest
from conftest import TEST_CSRF
from sqlalchemy import create_engine, text
from test_common_card_fields import card, collection
from test_vocabulary_editing import headers

from app.csv_v2 import decode_grammar, encode_grammar
from app.grammar import (
    GRAMMAR_DEFINITIONS,
    GRAMMAR_FIELDS,
    apply_structured_input,
    legacy_from_structured,
    merge_structured,
    register_grammar_definition,
    structured_from_legacy,
    unregister_grammar_definition,
    validate_structured_grammar,
)
from app.models import VocabularyEntry

H = {"X-CSRF-Token": TEST_CSRF}


def test_definitions_are_data_with_explicit_types_options_and_conditions():
    for language, definition in GRAMMAR_DEFINITIONS.items():
        assert definition["legacy_name"] in {"italian", "greek"}
        assert definition["genders"]
        fields = definition["schema"]
        assert fields["gender"]["type"] == "enum"
        assert set(fields["gender"]["options"]) == set(definition["genders"])
        assert fields["gender"]["required_for"] == ["noun"]
        assert fields["adjective_gender"]["required_for"] == ["adjective"]
        assert fields["example"]["csv_key"] == "example"
        assert fields["pronunciation"]["csv_key"] == "pronunciation"
        assert fields["gender"]["storage"].startswith(definition["legacy_name"])
        assert fields["example"]["storage"].startswith(definition["legacy_name"])
    assert GRAMMAR_DEFINITIONS["it"]["schema"]["pronunciation"]["storage"] == (
        "pronunciation"
    )


def test_structured_validation_reports_actionable_errors():
    valid = {
        "it": {
            "gender": "masculine",
            "example": "La casa è grande.",
            "pronunciation": "ˈkaza",
            "forms": {"feminine_singular": "casa"},
        },
        "el": {"gender": "neuter", "adjective_gender": "feminine"},
    }
    assert validate_structured_grammar(valid, ("it", "el"), "noun") == []
    cases = [
        (
            {"en": {"example": "hello"}},
            ("en", "it"),
            "noun",
            "grammar.en",
            "No grammar definition",
        ),
        (
            {"it": {"typo": "value"}},
            ("it", "el"),
            "noun",
            "grammar.it.typo",
            "Unknown grammar field",
        ),
        (
            {"it": {"forms": {"typo": "value"}}},
            ("it", "el"),
            "adjective",
            "grammar.it.forms",
            "Unknown form",
        ),
        (
            {"it": {"gender": "neuter"}},
            ("it", "el"),
            "noun",
            "grammar.it.gender",
            "Choose a listed value",
        ),
        (
            {"it": {"example": 12}},
            ("it", "el"),
            "noun",
            "grammar.it.example",
            "must be text",
        ),
        (
            {"it": {"example": "x" * 10_001}},
            ("it", "el"),
            "noun",
            "grammar.it.example",
            "too long",
        ),
        (
            {"it": {"example": "x"}},
            ("it", "el"),
            "noun",
            "grammar.it.gender",
            "Choose gender",
        ),
    ]
    for grammar, languages, word_type, path, message in cases:
        errors = validate_structured_grammar(grammar, languages, word_type)
        assert any(
            error["path"] == path and message in error["message"]
            for error in errors
        ), (grammar, errors)
    assert validate_structured_grammar(None, ("en", "da")) == []


def test_legacy_grammar_round_trips_through_the_structured_store():
    values = {
        "italian_gender": "masculine",
        "italian_plural": "cose",
        "italian_example": "La casa.",
        "pronunciation": "ˈkaza",
        "italian_adjective_gender": "feminine",
        "italian_feminine_singular": "casa",
        "italian_masculine_plural": "casi",
        "greek_gender": "neuter",
        "greek_plural": "σπίτια",
        "greek_example": "Το σπίτι.",
        "greek_pronunciation": "ˈspiti",
        "greek_adjective_gender": "masculine",
        "greek_neuter_singular": "σπίτι",
        "greek_neuter_plural": "σπίτια",
    }
    structured = structured_from_legacy(values, ("it", "el"))
    assert structured["it"] == {
        "gender": "masculine",
        "plural": "cose",
        "example": "La casa.",
        "pronunciation": "ˈkaza",
        "adjective_gender": "feminine",
        "forms": {
            "feminine_singular": "casa",
            "masculine_plural": "casi",
        },
    }
    assert structured["el"]["pronunciation"] == "ˈspiti"
    assert legacy_from_structured(structured, languages=("it", "el")) == values
    merged = merge_structured(
        structured, {"it": {"plural": "case nuove"}}, ("it", "el")
    )
    assert merged["it"]["plural"] == "case nuove"
    assert merged["it"]["gender"] == "masculine"
    assert merge_structured(structured, {}, ("it", "el")) == structured


def test_mixed_pair_accepts_only_the_defined_language(logged_in):
    client = logged_in
    group = collection(client, "en", "it", "Structured mixed")
    response = client.post(
        f"/api/collections/{group['id']}/cards",
        headers=H,
        json={
            "source_text": "tall",
            "target_text": "alto",
            "word_type": "noun",
            "grammar": {"en": {"example": "tall tree"}},
        },
    )
    assert response.status_code == 422, response.text
    assert response.json()["error"]["fields"] == ["grammar.en"]

    saved = card(
        client,
        group,
        word_type="noun",
        grammar={"it": {"gender": "masculine", "example": "alto"}},
    )
    assert saved["grammar"] == {"it": {"gender": "masculine", "example": "alto"}}
    assert saved["italian_gender"] == "masculine"
    assert "greek_gender" not in saved
    entry = client.get(f"/api/vocabulary/{saved['id']}").json()
    assert entry["grammar"] == saved["grammar"]


def test_api_validates_structured_input_without_losing_legacy_behaviour(logged_in):
    client = logged_in
    group = collection(client, "it", "el", "Structured grammar")
    invalid = client.post(
        f"/api/collections/{group['id']}/cards",
        headers=H,
        json={
            "source_text": "casa",
            "target_text": "σπίτι",
            "word_type": "noun",
            "grammar": {"it": {"gender": "neuter"}, "el": {"gender": "neuter"}},
        },
    )
    assert invalid.status_code == 422, invalid.text
    assert invalid.json()["error"]["fields"] == ["grammar.it.gender"]

    saved = card(
        client,
        group,
        word_type="adjective",
        grammar={
            "it": {
                "adjective_gender": "masculine",
                "forms": {"feminine_singular": "bella"},
            },
            "el": {"adjective_gender": "feminine", "pronunciation": "ˈomorfi"},
        },
    )
    assert saved["grammar"]["it"]["forms"] == {"feminine_singular": "bella"}
    assert saved["italian_feminine_singular"] == "bella"
    assert saved["grammar"]["el"]["pronunciation"] == "ˈomorfi"

    response = client.patch(
        f"/api/vocabulary/{saved['id']}",
        headers=headers(client),
        json={"grammar": {"it": {"adjective_gender": "neuter"}}},
    )
    assert response.status_code == 422, response.text
    assert response.json()["error"]["fields"] == ["grammar.it.adjective_gender"]

    response = client.patch(
        f"/api/vocabulary/{saved['id']}",
        headers=headers(client),
        json={"pronunciation": "ˈbɛlla"},
    )
    assert response.status_code == 200, response.text
    assert response.json()["entry"]["grammar"]["it"]["forms"] == {
        "feminine_singular": "bella"
    }


def test_csv_v2_grammar_fixture_handles_example_and_pronunciation():
    class Row:
        italian_gender = "masculine"
        italian_plural = "casi"
        italian_example = "Il caso è chiuso."
        pronunciation = "ˈkazo"
        italian_adjective_gender = None
        greek_gender = "feminine"
        greek_example = "Η περίπτωση."
        greek_pronunciation = "períptosi"

    row = Row()
    cell = encode_grammar(row, "it")
    assert "example" in cell and "pronunciation" in cell
    assert decode_grammar(cell, "it") == {
        "italian_gender": "masculine",
        "italian_plural": "casi",
        "italian_example": "Il caso è chiuso.",
        "pronunciation": "ˈkazo",
    }
    assert "example" in encode_grammar(row, "el")
    with pytest.raises(ValueError, match="Unknown grammar field"):
        decode_grammar('{"typo": "value"}', "it")
    with pytest.raises(ValueError, match="No grammar definition"):
        decode_grammar('{"example": "hello"}', "en")


def test_test_only_definition_needs_no_column_migration_or_component():
    definition = {
        "legacy_name": "synthetic",
        "genders": ["animate"],
        "fields": {
            "gender": {
                "type": "enum",
                "options": ["animate"],
                "storage": "synthetic_gender",
                "word_types": ["noun"],
                "required_for": ["noun"],
                "csv_key": "gender",
            },
            "plural": {
                "type": "text",
                "max_length": 500,
                "storage": "synthetic_plural",
                "word_types": ["noun"],
                "csv_key": "plural",
            },
            "adjective_gender": {
                "type": "enum",
                "options": ["animate"],
                "storage": "synthetic_adjective_gender",
                "word_types": ["adjective"],
                "required_for": ["adjective"],
                "csv_key": "adjective_gender",
            },
            "forms": {},
            "example": {
                "type": "long_text",
                "max_length": 10000,
                "storage": "synthetic_example",
                "word_types": ["noun"],
                "csv_key": "example",
            },
            "pronunciation": {
                "type": "long_text",
                "max_length": 10000,
                "storage": "synthetic_pronunciation",
                "word_types": ["noun"],
                "csv_key": "pronunciation",
            },
        },
    }
    register_grammar_definition("zz", definition)
    try:
        assert "synthetic_gender" in set(GRAMMAR_FIELDS)
        assert "synthetic_gender" not in VocabularyEntry.__table__.columns
        grammar = {"zz": {"gender": "animate", "example": "Synthetic text."}}
        assert validate_structured_grammar(grammar, ("zz", "en"), "noun") == []
        values = legacy_from_structured(grammar, languages=("zz", "en"))
        assert values["synthetic_gender"] == "animate"
        assert values["synthetic_example"] == "Synthetic text."
        assert structured_from_legacy(values, ("zz", "en")) == grammar
        assert encode_grammar(type("Entry", (), {"grammar": grammar})(), "zz") == (
            '{"example": "Synthetic text.", "gender": "animate"}'
        )
        row = type("Entry", (), {"grammar": grammar})()
        assert decode_grammar(encode_grammar(row, "zz"), "zz") == values
        errors, structured = apply_structured_input(
            {"word_type": "noun", "grammar": grammar},
            ("zz", "en"),
            "noun",
            type("Model", (), {"synthetic_gender": None}),
        )
        assert errors == [] and structured == grammar
    finally:
        unregister_grammar_definition("zz")


def test_migration_backfills_structured_grammar_without_rewriting_legacy(test_database):
    from alembic.config import Config
    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    from alembic.script import ScriptDirectory

    from app.models import Base

    schema = "grammar_" + uuid4().hex
    engine = create_engine(test_database)
    scripts = ScriptDirectory.from_config(
        Config(str(Path(__file__).parents[1] / "alembic.ini"))
    )
    with engine.connect() as connection:
        try:
            connection.execute(text(f'CREATE SCHEMA "{schema}"'))
            connection.execute(text(f'SET search_path TO "{schema}"'))
            connection.execute(text("CREATE TABLE accounts (id UUID PRIMARY KEY)"))
            connection.execute(
                text("CREATE TABLE languages (id VARCHAR(16) PRIMARY KEY)")
            )
            connection.execute(text("INSERT INTO languages VALUES ('it'), ('el')"))
            Base.metadata.create_all(connection, tables=[VocabularyEntry.__table__])
            connection.execute(
                text("ALTER TABLE vocabulary_entries DROP COLUMN grammar")
            )
            entry_id = uuid4()
            connection.execute(
                text(
                    "INSERT INTO vocabulary_entries "
                    "(id, italian, greek, word_type, italian_gender, "
                    "italian_example, pronunciation, greek_gender) "
                    "VALUES (:id, 'casa', 'σπίτι', 'noun', 'common', "
                    "'La casa.', 'ˈkaza', 'neuter')"
                ),
                {"id": entry_id},
            )
            before = dict(
                connection.execute(text("SELECT * FROM vocabulary_entries"))
                .mappings()
                .one()
            )
            with Operations.context(MigrationContext.configure(connection)):
                scripts.get_revision("b7c9d1e4f206").module.upgrade()
            after = dict(
                connection.execute(text("SELECT * FROM vocabulary_entries"))
                .mappings()
                .one()
            )
            assert {key: after[key] for key in before} == before
            assert after["grammar"] == {
                "it": {"example": "La casa.", "pronunciation": "ˈkaza"},
                "el": {"gender": "neuter"},
            }
            with Operations.context(MigrationContext.configure(connection)):
                scripts.get_revision("b7c9d1e4f206").module.downgrade()
            assert "grammar" not in connection.execute(
                text("SELECT * FROM vocabulary_entries")
            ).mappings().one()
        finally:
            connection.rollback()
    engine.dispose()
