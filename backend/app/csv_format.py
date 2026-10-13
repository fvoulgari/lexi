"""Versioned CSV exchange preserves text while making spreadsheet cells safe."""

FORMAT_VERSION = "italian-notebook-v1"
FORMULA_MARKERS = ("=", "+", "-", "@", "＝", "＋", "－", "＠")
TEXT_PREFIXES = ("'", "\t", "\r", "\n")


def needs_text_prefix(value):
    return value.startswith(TEXT_PREFIXES) or value.lstrip().startswith(FORMULA_MARKERS)


def spreadsheet_text(value):
    value = "" if value is None else str(value)
    return "'" + value if needs_text_prefix(value) else value


def restore_text(value):
    if value.startswith("'") and needs_text_prefix(value[1:]):
        return value[1:]
    return value
