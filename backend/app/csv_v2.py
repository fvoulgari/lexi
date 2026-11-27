"""Language-ID-keyed columns for CSV format v2.

Texts and optional grammar are named by the language IDs they describe, so a
row never depends on the position of a text in a pair. The JSON cells use the
same configuration as the structured store and compatibility columns.
"""

import json

from app.grammar import (
    GRAMMAR_DEFINITIONS,
    grammar_languages,
    iter_fields,
    legacy_from_structured,
    structured_from_legacy,
    validate_structured_grammar,
)
from app.languages import LANGUAGES
from app.registry import get_registry


def text_column(language):
    return f"text_{language}"


def grammar_column(language):
    return f"grammar_{language}"


BASE_COLUMNS = (
    "csv_format",
    "entry_id",
    "collection_id",
    "collection_name",
    "source_language",
    "target_language",
    "card_source_language",
    "card_target_language",
)
TRAILING_COLUMNS = (
    "tags",
    "notes",
    "unit_code",
    "unit_title",
    "unit_sort_order",
)


def text_columns(languages=None):
    """Text columns for the registered languages, or an explicit subset."""
    ids = get_registry().ids if languages is None else tuple(languages)
    return tuple(text_column(language) for language in ids)


def grammar_columns(languages=None):
    """One grammar cell per registered language; basic languages stay empty."""
    ids = get_registry().ids if languages is None else tuple(languages)
    return tuple(grammar_column(language) for language in ids)


def v2_columns(languages=None):
    """The v2 header for the currently registered languages."""
    return (
        *BASE_COLUMNS,
        *text_columns(languages),
        "word_type",
        *grammar_columns(languages),
        *TRAILING_COLUMNS,
    )


def v3_columns(languages=None):
    """Lossless exchange header: v2 plus definition version and full metadata."""
    return (*v2_columns(languages), "schema_version", "metadata")


def template_columns(languages):
    """Compact, importable header for one language pair.

    Only the selected languages get text columns, and only languages with a
    grammar definition get a grammar column. Everything is derived from the
    registry-backed pair and the grammar definitions; there is no per-pair
    template table.
    """
    ids = tuple(dict.fromkeys(languages))
    return (
        "csv_format",
        "card_source_language",
        "card_target_language",
        *text_columns(ids),
        "word_type",
        *grammar_columns(grammar_languages(ids)),
        "notes",
        "tags",
    )


def vocabulary_columns(languages):
    """Spreadsheet-friendly export: required text and shared fields only."""
    ids = tuple(dict.fromkeys(languages))
    return (
        "csv_format",
        "card_source_language",
        "card_target_language",
        *text_columns(ids),
        "word_type",
        "notes",
        "tags",
    )


# Frozen bootstrap header for fixtures and historical format comparisons.
# Runtime export and import use the registry-driven helpers above.
TEXT_COLUMNS = tuple(text_column(language) for language in LANGUAGES)
GRAMMAR_COLUMNS = tuple(grammar_column(language) for language in LANGUAGES)
COLUMNS = v2_columns(LANGUAGES)


def grammar_value(field, value, language=None):
    """Drop unresolved legacy aliases, keeping locally valid enum options."""
    if value is None or value == "":
        return None
    if value == "common":
        spec = None
        if language in GRAMMAR_DEFINITIONS:
            spec = dict(iter_fields(GRAMMAR_DEFINITIONS[language])).get(field)
        if spec is None or "common" not in spec.get("options", ()):
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
                    if (
                        converted := grammar_value(
                            f"forms.{name}", found, language
                        )
                    )
                    is not None
                }
                if forms:
                    cell["forms"] = forms
            elif (converted := grammar_value(key, value, language)) is not None:
                cell[key] = converted
    else:
        def value(field):
            return grammar_value(field, getattr(entry, field, None), language)

        for key, field in (
            ("gender", definition["noun_gender"]),
            ("plural", definition["noun_plural"]),
            ("example", definition["example"]),
            ("pronunciation", definition["pronunciation"]),
            ("adjective_gender", definition["adjective_gender"]),
        ):
            if not field:
                continue
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


def decode_grammar_cell(value, language):
    """Return ``(legacy_values, structured_cell)`` for one grammar column.

    The structured cell is required for definitions whose fields have no
    compatibility column; dropping it would silently lose Danish grammar.
    """
    if not value:
        return {}, None
    if language not in GRAMMAR_DEFINITIONS:
        raise ValueError(f"No grammar definition for {language}.")
    try:
        cell = json.loads(value)
    except (TypeError, json.JSONDecodeError):
        raise ValueError(f"grammar_{language} must be a JSON object.") from None
    if not isinstance(cell, dict):
        raise ValueError(f"grammar_{language} must be a JSON object.")
    # Legacy exports wrote the unresolved "common" article alias for Italian
    # and Greek. Danish declares `common` as a real option, so only drop the
    # unresolved alias where this definition does not list it.
    normalized = {}
    for key, found in cell.items():
        if key == "forms" and isinstance(found, dict):
            forms = {
                name: converted
                for name, item in found.items()
                if (
                    converted := grammar_value(
                        f"forms.{name}", item, language
                    )
                )
                is not None
            }
            if forms:
                normalized["forms"] = forms
        elif (converted := grammar_value(key, found, language)) is not None:
            normalized[key] = converted
    cell = normalized
    errors = validate_structured_grammar({language: cell}, (language,))
    if errors:
        raise ValueError(
            f"grammar_{language}: "
            + "; ".join(f"{error['path']}: {error['message']}" for error in errors)
        )
    return (
        legacy_from_structured({language: cell}, languages=(language,)),
        cell or None,
    )


def decode_grammar(value, language):
    """Compatibility-column values from one grammar cell."""
    return decode_grammar_cell(value, language)[0]


__all__ = [
    "COLUMNS",
    "GRAMMAR_COLUMNS",
    "TEXT_COLUMNS",
    "decode_grammar",
    "decode_grammar_cell",
    "encode_grammar",
    "grammar_column",
    "grammar_columns",
    "grammar_value",
    "structured_from_legacy",
    "template_columns",
    "text_column",
    "text_columns",
    "vocabulary_columns",
    "v2_columns",
]
