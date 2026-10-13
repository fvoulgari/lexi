"""Shared matching policy for library warnings and CSV duplicate skips."""

import unicodedata


def normalized_pair(italian, greek):
    return tuple(
        unicodedata.normalize("NFC", value.strip()).casefold()
        for value in (italian, greek)
    )
