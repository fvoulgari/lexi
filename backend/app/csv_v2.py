"""Language-ID-keyed columns for CSV format v2.

Texts and optional grammar are named by the language IDs they describe, so a
row never depends on the position of a text in a pair. The JSON cells use the
same configuration as the structured store and compatibility columns.
"""

import json

from app.grammar import (
    GRAMMAR_DEFINITIONS,
    legacy_from_structured,
    structured_from_legacy,
    validate_structured_grammar,
)
from app.languages import LANGUAGES


def text_column(language):
    return f"text_{language}"


def grammar_column(language):
    return f"grammar_{language}"


TEXT_COLUMNS = tuple(text_column(language) for language in LANGUAGES)
GRAMMAR_COLUMNS = tuple(grammar_column(language) for language in LANGUAGES)

COLUMNS = (
    "csv_format",
    "entry_id",
    "collection_id",
    "collection_name",
    "source_language",
    "target_language",
    "card_source_language",
    "card_target_language",
    *TEXT_COLUMNS,
    "word_type",
    *GRAMMAR_COLUMNS,
    "tags",
    "notes",
    "unit_code",
    "unit_title",
    "unit_sort_order",
)


def grammar_value(field, value):
    """Drop legacy values that must not be presented as real grammar."""
    if value is None or value == "":
        return None
    if field.endswith(("_gender", "adjective_gender")) and value == "common":
        return None
    return value


def encode_grammar(entry, language):
    """Serialize one language's optional grammar fields for export."""
    definition = GRAMMAR_DEFINITIONS.get(language)
    if definition is None:
        return ""
    stored = (getattr(entry, "grammar", None) or {}).get(language)
    cell = {}
    if stored:
        for key, value in stored.items():
            if key == "forms":
                forms = {
                    name: converted
                    for name, found in value.items()
                    if (converted := grammar_value(name, found)) is not None
                }
                if forms:
                    cell["forms"] = forms
            elif (converted := grammar_value(key, value)) is not None:
                cell[key] = converted
    else:
        def value(field):
            return grammar_value(field, getattr(entry, field, None))

        for key, field in (
            ("gender", definition["noun_gender"]),
            ("plural", definition["noun_plural"]),
            ("example", definition["example"]),
            ("pronunciation", definition["pronunciation"]),
            ("adjective_gender", definition["adjective_gender"]),
        ):
            found = value(field)
            if found is not None:
                cell[key] = found
        forms = {
            key: found
            for key, field in definition["forms"].items()
            if (found := value(field)) is not None
        }
        if forms:
            cell["forms"] = forms
    return json.dumps(cell, ensure_ascii=False, sort_keys=True) if cell else ""


def decode_grammar(value, language):
    """Turn one grammar cell into compatibility-column values.

    Unknown keys, values and languages with no grammar definition are row
    errors so a typo never silently drops a card's optional fields.
    """
    if not value:
        return {}
    if language not in GRAMMAR_DEFINITIONS:
        raise ValueError(f"No grammar definition for {language}.")
    try:
        cell = json.loads(value)
    except (TypeError, json.JSONDecodeError):
        raise ValueError(f"grammar_{language} must be a JSON object.") from None
    if not isinstance(cell, dict):
        raise ValueError(f"grammar_{language} must be a JSON object.")
    # Legacy exports wrote the unresolved "common" article alias. Keep reading
    # those cells as unset, as the importer always has.
    cell = {
        key: found
        for key, found in cell.items()
        if key == "forms" or found != "common"
    }
    errors = validate_structured_grammar({language: cell}, (language,))
    if errors:
        raise ValueError(
            f"grammar_{language}: "
            + "; ".join(f"{error['path']}: {error['message']}" for error in errors)
        )
    return legacy_from_structured({language: cell}, languages=(language,))


__all__ = [
    "COLUMNS",
    "GRAMMAR_COLUMNS",
    "TEXT_COLUMNS",
    "decode_grammar",
    "encode_grammar",
    "grammar_column",
    "grammar_value",
    "structured_from_legacy",
    "text_column",
]
