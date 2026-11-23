"""Shared matching policy for library warnings and CSV duplicate skips."""

import unicodedata


def normalized_pair(italian, greek):
    return tuple(
        unicodedata.normalize("NFC", value.strip()).casefold()
        for value in (italian, greek)
    )


def normalized_language_pair(languages, texts):
    """Match a card's texts by language ID rather than by text-column position."""
    return tuple(
        sorted(
            (
                language,
                unicodedata.normalize("NFC", text.strip()).casefold(),
            )
            for language, text in zip(languages, texts, strict=True)
        )
    )
