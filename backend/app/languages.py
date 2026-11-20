"""Stable language identifiers; preserve legacy direction keys and learning state."""

LANGUAGES = ("da", "el", "en", "it")
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


def pair(a, b):
    if a not in LANGUAGES or b not in LANGUAGES or a == b:
        raise ValueError("Choose two different supported languages.")
    return tuple(sorted((a, b)))
