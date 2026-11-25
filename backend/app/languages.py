"""Language helpers backed by the database registry.

The constants below are bootstrap values for migrations and fresh installs.
Every runtime check goes through :mod:`app.registry`, whose data comes from the
``languages`` and ``practice_directions`` tables, so a registered language works
without a code change while curation stays a separate concern.
"""

import json
from collections.abc import Mapping
from pathlib import Path

from app.registry import get_registry

# Bootstrap values only: historical migrations and the initial seed read this
# configuration. Runtime checks use the database registry, so registering a
# language never requires a change to application logic.
_LANGUAGE_CATALOGUE = json.loads(
    (Path(__file__).with_name("language_catalogue.json")).read_text(encoding="utf-8")
)

LANGUAGES = tuple(
    sorted(language["id"] for language in _LANGUAGE_CATALOGUE["languages"])
)
LANGUAGE_LABELS = {
    language["id"]: language["label"]
    for language in _LANGUAGE_CATALOGUE["languages"]
}
LANGUAGE_METADATA = {
    language["id"]: (
        language["script"],
        language["text_direction"],
        language["enhanced"],
        language["publicly_available"],
    )
    for language in _LANGUAGE_CATALOGUE["languages"]
}
LEGACY_DIRECTIONS = tuple(sorted(_LANGUAGE_CATALOGUE["legacy_directions"]))
DIRECTION_PAIRS = {
    **{
        name: tuple(languages)
        for name, languages in _LANGUAGE_CATALOGUE["legacy_directions"].items()
    },
    **{
        f"{a}_to_{b}": (a, b)
        for a in LANGUAGES
        for b in LANGUAGES
        if a != b and {a, b} != {"it", "el"}
    },
}


def language_label(language):
    return get_registry().label(language)


def pair(a, b):
    return get_registry().validate_pair(a, b)


def same_pair(first, second, other_first, other_second):
    """Compare unordered language IDs without raising on missing/invalid data."""
    try:
        return pair(first, second) == pair(other_first, other_second)
    except ValueError:
        return False


def pair_mismatch_message(first, second, other_first, other_second):
    """Explain which pair a card needs for a collection membership change."""
    return (
        f"Card language pair ({first}/{second}) differs from collection pair "
        f"({other_first}/{other_second}). Use a collection with the same "
        "language pair."
    )


def direction_key(a, b):
    """Directed practice key for a registered ordered language pair."""
    return get_registry().direction_for(a, b)


def direction_languages(key):
    return get_registry().direction_languages(key)


def is_legacy_direction(key):
    return get_registry().is_legacy_direction(key)


def _field(card, *names):
    if isinstance(card, Mapping):
        return next((card[name] for name in names if name in card), None)
    return next(
        (getattr(card, name) for name in names if hasattr(card, name)),
        None,
    )


def pair_directions(a, b):
    """Both directed practice keys for one unordered registered language pair."""
    return get_registry().pair_directions(a, b)


def card_languages(card):
    """A card's explicit language IDs, or the legacy Italian/Greek text slots."""
    return (
        _field(card, "source_language") or "it",
        _field(card, "target_language") or "el",
    )


def card_directions(card):
    """Directions a card can be practised in; empty when its IDs are invalid."""
    try:
        return pair_directions(*card_languages(card))
    except ValueError:
        return ()


def validate_card_direction(card, direction):
    """Check a practice direction against the card's own language IDs."""
    direction_languages(direction)
    if direction not in card_directions(card):
        raise ValueError("Direction does not match this card.")


def card_text(card, language):
    """Primary text by explicit language ID, including reversed legacy snapshots.

    The two primary text slots are language-keyed by the card's own IDs, so an
    old snapshot with ``source_language='el'`` is read the same way as a card
    created today; grammar fields keep their historical language names.
    """
    source, target = card_languages(card)
    if language == source:
        return _field(card, "source_text", "italian")
    if language == target:
        return _field(card, "target_text", "greek")
    return None


def card_slots(source, target, source_text, target_text):
    """Legacy-compatible text columns for a card's explicit language pair."""
    texts = {source: source_text, target: target_text}
    if "it" in texts and "el" in texts:
        # Italian/Greek cards keep Italian in `italian` and Greek in `greek`,
        # whichever direction the caller supplied. No new columns per language.
        return "it", "el", texts["it"], texts["el"]
    return source, target, source_text, target_text
