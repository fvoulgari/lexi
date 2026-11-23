"""The language registry is the only source of pair, direction and text rules."""

from itertools import product

import pytest

from app.languages import (
    DIRECTION_PAIRS,
    LANGUAGE_LABELS,
    LANGUAGES,
    card_slots,
    card_text,
    direction_key,
    direction_languages,
    language_label,
    pair,
    same_pair,
)


@pytest.mark.parametrize("a,b", list(product(LANGUAGES, LANGUAGES)))
def test_registry_accepts_every_ordered_pair_and_rejects_identical(a, b):
    if a == b:
        with pytest.raises(ValueError, match="two different supported languages"):
            pair(a, b)
        with pytest.raises(ValueError):
            direction_key(a, b)
        return
    assert pair(a, b) == tuple(sorted((a, b)))
    key = direction_key(a, b)
    assert key in DIRECTION_PAIRS
    assert direction_languages(key) == (a, b)


@pytest.mark.parametrize("a,b", [("it", "el"), ("el", "it")])
def test_legacy_direction_keys_are_preserved(a, b):
    key = direction_key(a, b)
    assert key == ("italian_to_greek" if a == "it" else "greek_to_italian")
    assert direction_languages(key) == (a, b)
    assert set(DIRECTION_PAIRS[key]) == {"it", "el"}


@pytest.mark.parametrize("value", [None, "", "xx", "ITA", 7])
def test_unsupported_languages_are_rejected(value):
    with pytest.raises(ValueError, match="different supported languages"):
        pair(value, "it")
    with pytest.raises(ValueError):
        direction_key("it", value)


def test_labels_come_from_the_registry():
    assert set(LANGUAGE_LABELS) == set(LANGUAGES)
    assert [language_label(code) for code in LANGUAGES] == [
        "Danish",
        "Greek",
        "English",
        "Italian",
    ]
    with pytest.raises(ValueError) as error:
        pair("it", "it")
    assert "Danish, Greek, English, Italian" in str(error.value)


def test_same_pair_compares_language_ids_in_either_order():
    assert same_pair("el", "it", "it", "el")
    assert same_pair("en", "da", "da", "en")
    assert not same_pair("en", "da", "en", "el")
    assert not same_pair("it", "it", "it", "el")
    assert not same_pair("xx", "it", "it", "el")


@pytest.mark.parametrize(
    "source,target,source_text,target_text",
    [
        ("it", "el", "ciao", "γεια"),
        ("el", "it", "γεια", "ciao"),
        ("en", "da", "hello", "hej"),
        ("da", "en", "hej", "hello"),
    ],
)
def test_text_maps_by_explicit_language_id(
    source, target, source_text, target_text
):
    card = {
        "source_language": source,
        "target_language": target,
        "italian": source_text,
        "greek": target_text,
    }
    expected = {source: source_text, target: target_text}
    for language in (source, target):
        assert card_text(card, language) == expected[language]
    stored = card_slots(source, target, source_text, target_text)
    canonical = ("it", "el") if {source, target} == {"it", "el"} else (source, target)
    assert stored[0:2] == canonical
    assert card_text(
        {
            "source_language": stored[0],
            "target_language": stored[1],
            "italian": stored[2],
            "greek": stored[3],
        },
        source,
    ) == source_text
    assert card_text(
        {
            "source_language": stored[0],
            "target_language": stored[1],
            "italian": stored[2],
            "greek": stored[3],
        },
        target,
    ) == target_text


def test_reversed_legacy_snapshot_text_follows_its_own_language_ids():
    snapshot = {
        "source_language": "el",
        "target_language": "it",
        "italian": "γεια",
        "greek": "ciao",
    }
    assert card_text(snapshot, "el") == "γεια"
    assert card_text(snapshot, "it") == "ciao"
    assert card_text(snapshot, "da") is None
