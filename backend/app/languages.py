"""Stable language identifiers; preserve legacy direction keys and learning state."""

from collections.abc import Mapping

LANGUAGES = ("da", "el", "en", "it")
LANGUAGE_LABELS = {
    "da": "Danish",
    "el": "Greek",
    "en": "English",
    "it": "Italian",
}
DIRECTION_PAIRS = {
    "greek_to_italian": ("el", "it"),
    "italian_to_greek": ("it", "el"),
    **{
        f"{a}_to_{b}": (a, b)
        for a in LANGUAGES
        for b in LANGUAGES
        if a != b and {a, b} != {"it", "el"}
    },
}


def language_label(language):
    return LANGUAGE_LABELS.get(language, str(language))


def _invalid_pair_message():
    return (
        "Choose two different supported languages: "
        + ", ".join(language_label(language) for language in LANGUAGES)
        + "."
    )


def pair(a, b):
    if a not in LANGUAGES or b not in LANGUAGES or a == b:
        raise ValueError(_invalid_pair_message())
    return tuple(sorted((a, b)))


def same_pair(first, second, other_first, other_second):
    """Compare unordered language IDs without raising on missing/invalid data."""
    try:
        return pair(first, second) == pair(other_first, other_second)
    except ValueError:
        return False


def direction_key(a, b):
    """Directed practice key for a legacy or generated language pair."""
    if (a, b) == ("el", "it"):
        return "greek_to_italian"
    if (a, b) == ("it", "el"):
        return "italian_to_greek"
    if a not in LANGUAGES or b not in LANGUAGES or a == b:
        raise ValueError(_invalid_pair_message())
    return f"{a}_to_{b}"


def direction_languages(key):
    try:
        return DIRECTION_PAIRS[key]
    except (KeyError, TypeError):
        raise ValueError("Unsupported practice direction.") from None


def _field(card, *names):
    if isinstance(card, Mapping):
        return next((card[name] for name in names if name in card), None)
    return next(
        (getattr(card, name) for name in names if hasattr(card, name)),
        None,
    )


def card_text(card, language):
    """Primary text by explicit language ID, including reversed legacy snapshots.

    The two primary text slots are language-keyed by the card's own IDs, so an
    old snapshot with ``source_language='el'`` is read the same way as a card
    created today; grammar fields keep their historical language names.
    """
    source = _field(card, "source_language") or "it"
    target = _field(card, "target_language") or "el"
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
