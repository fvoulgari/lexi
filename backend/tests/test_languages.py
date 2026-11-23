"""The language registry is the only source of pair, direction and text rules."""

from itertools import product

import pytest

from app.languages import (
    DIRECTION_PAIRS,
    LANGUAGE_LABELS,
    LANGUAGES,
    card_directions,
    card_languages,
    card_slots,
    card_text,
    direction_key,
    direction_languages,
    language_label,
    pair,
    pair_directions,
    same_pair,
    validate_card_direction,
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


@pytest.mark.parametrize("a,b", [("en", "da"), ("en", "el"), ("it", "el")])
def test_pair_directions_derives_both_keys_from_the_registry(a, b):
    assert pair_directions(a, b) == pair_directions(b, a)
    assert set(pair_directions(a, b)) == {direction_key(a, b), direction_key(b, a)}
    assert set(pair_directions(a, b)) <= set(DIRECTION_PAIRS)


@pytest.mark.parametrize(
    "card,expected",
    [
        ({"source_language": "da", "target_language": "en"}, ("da", "en")),
        ({"source_language": "el", "target_language": "it"}, ("el", "it")),
        ({"source_language": None, "target_language": None}, ("it", "el")),
        ({}, ("it", "el")),
    ],
)
def test_card_directions_use_explicit_ids_or_legacy_context(card, expected):
    assert card_languages(card) == expected
    assert card_directions(card) == pair_directions(*expected)
    for direction in card_directions(card):
        validate_card_direction(card, direction)


@pytest.mark.parametrize("direction", ["en_to_da", "da_to_en"])
def test_card_direction_rejects_another_pair_or_unsupported_key(direction):
    card = {"source_language": "it", "target_language": "el"}
    with pytest.raises(ValueError, match="does not match this card"):
        validate_card_direction(card, direction)
    with pytest.raises(ValueError, match="Unsupported practice direction"):
        validate_card_direction(card, "xx_to_el")
    assert card_directions({"source_language": "xx", "target_language": "it"}) == ()
