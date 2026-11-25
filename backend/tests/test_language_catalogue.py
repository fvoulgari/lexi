"""The public catalogue is the curated subset of the database registry."""

import os

import pytest
from pydantic import ValidationError
from sqlalchemy import create_engine, text

from app.languages import (
    card_slots,
    card_text,
    direction_key,
    direction_languages,
    pair,
    pair_directions,
    same_pair,
)
from app.registry import refresh_registry
from app.schemas import ProfileCreate

CURATED = {"ar", "da", "el", "en", "it", "ja"}


def test_catalogue_exposes_curated_metadata_and_legacy_direction_keys(client):
    payload = client.get("/api/languages").json()
    assert {item["id"] for item in payload["languages"]} == CURATED
    by_id = {item["id"]: item for item in payload["languages"]}
    assert by_id["el"] == {
        "id": "el",
        "label": "Greek",
        "script": "Grek",
        "text_direction": "ltr",
        "enhanced": True,
    }
    assert by_id["da"]["enhanced"] is False
    assert by_id["en"]["script"] == "Latn"
    assert by_id["ja"] == {
        "id": "ja",
        "label": "Japanese",
        "script": "Jpan",
        "text_direction": "ltr",
        "enhanced": False,
    }
    assert by_id["ar"] == {
        "id": "ar",
        "label": "Arabic",
        "script": "Arab",
        "text_direction": "rtl",
        "enhanced": False,
    }

    directions = {item["key"]: item for item in payload["directions"]}
    assert len(directions) == len(CURATED) * (len(CURATED) - 1)
    for first, second in (("ja", "en"), ("ar", "en"), ("ja", "ar")):
        assert directions[f"{first}_to_{second}"] == {
            "key": f"{first}_to_{second}",
            "prompt_language": first,
            "answer_language": second,
            "legacy": False,
        }
        assert directions[f"{second}_to_{first}"]["legacy"] is False
    assert directions["greek_to_italian"] == {
        "key": "greek_to_italian",
        "prompt_language": "el",
        "answer_language": "it",
        "legacy": True,
    }
    assert directions["italian_to_greek"]["legacy"] is True
    assert directions["en_to_da"]["legacy"] is False
    assert direction_key("el", "it") == "greek_to_italian"
    assert direction_languages("greek_to_italian") == ("el", "it")
    assert pair_directions("el", "it") == (
        "greek_to_italian",
        "italian_to_greek",
    )


def test_registry_only_language_is_valid_internally_but_not_catalogued(client):
    engine = create_engine(os.environ["DATABASE_URL"])
    with engine.begin() as db:
        db.execute(
            text(
                "INSERT INTO languages "
                "(id, display_name, script, text_direction, enhanced, "
                "publicly_available) VALUES ('zz', 'Synthetic', 'Latn', 'ltr', "
                "false, false)"
            )
        )
        db.execute(
            text(
                "INSERT INTO practice_directions "
                "(name, prompt_language, answer_language, legacy) "
                "VALUES ('zz_to_en', 'zz', 'en', false)"
            )
        )
        db.execute(
            text(
                "INSERT INTO practice_directions "
                "(name, prompt_language, answer_language, legacy) "
                "VALUES ('en_to_zz', 'en', 'zz', false)"
            )
        )
        refresh_registry(db)

    # Validation and card mapping come from the same registry rows.
    assert pair("zz", "en") == ("en", "zz")
    assert same_pair("zz", "en", "en", "zz") is True
    assert direction_key("zz", "en") == "zz_to_en"
    assert direction_languages("zz_to_en") == ("zz", "en")
    assert set(pair_directions("zz", "en")) == {"zz_to_en", "en_to_zz"}
    source, target, source_text, target_text = card_slots("zz", "en", "a", "b")
    assert (source, target, source_text, target_text) == ("zz", "en", "a", "b")
    card = {
        "source_language": "zz",
        "target_language": "en",
        "italian": "a",
        "greek": "b",
    }
    assert card_text(card, "zz") == "a"

    # The public API still exposes only curated rows after the same data change.
    payload = client.get("/api/languages").json()
    assert {item["id"] for item in payload["languages"]} == CURATED
    assert all(
        item["prompt_language"] in CURATED and item["answer_language"] in CURATED
        for item in payload["directions"]
    )
    engine.dispose()


def test_public_rtl_metadata_flows_without_frontend_branches(client):
    engine = create_engine(os.environ["DATABASE_URL"])
    with engine.begin() as db:
        db.execute(
            text(
                "INSERT INTO languages "
                "(id, display_name, script, text_direction, enhanced, "
                "publicly_available) VALUES ('qq', 'Synthetic RTL', 'Arab', "
                "'rtl', false, true)"
            )
        )
        db.execute(
            text(
                "INSERT INTO practice_directions "
                "(name, prompt_language, answer_language, legacy) "
                "VALUES ('qq_to_en', 'qq', 'en', false)"
            )
        )
    language = next(
        item
        for item in client.get("/api/languages").json()["languages"]
        if item["id"] == "qq"
    )
    assert language["text_direction"] == "rtl"
    assert language["script"] == "Arab"
    engine.dispose()


def test_request_validation_uses_the_registry_and_keeps_legacy_keys(client):
    assert ProfileCreate(
        display_name="Legacy", preferred_direction="greek_to_italian"
    ).preferred_direction == "greek_to_italian"
    with pytest.raises(ValidationError, match="Unsupported practice direction"):
        ProfileCreate(display_name="Invalid", preferred_direction="not_a_direction")
