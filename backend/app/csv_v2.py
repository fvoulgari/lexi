"""Language-ID-keyed columns for CSV format v2.

Texts and optional grammar are named by the language IDs they describe, so a
row never depends on the position of a text in a pair. Grammar values are
stored in the existing language-named compatibility columns; the JSON cells
below are only the exchange representation.
"""

import json

from app.grammar import GRAMMAR_DEFINITIONS
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


def _prefix(definition):
    return definition["noun_gender"].split("_", 1)[0]


def _example_field(definition):
    return f"{_prefix(definition)}_example"


def _pronunciation_field(definition):
    return (
        "pronunciation"
        if _prefix(definition) == "italian"
        else f"{_prefix(definition)}_pronunciation"
    )


def grammar_value(field, value):
    """Drop legacy values that must not be presented as real grammar."""
    if value is None or value == "":
        return None
    gender_fields = {
        "italian_gender",
        "greek_gender",
        "italian_adjective_gender",
        "greek_adjective_gender",
    }
    if field in gender_fields and value == "common":
        return None
    return value


def encode_grammar(entry, language):
    """Serialize one language's optional grammar fields for export."""
    definition = GRAMMAR_DEFINITIONS.get(language)
    if definition is None:
        return ""
    def value(field):
        return grammar_value(field, getattr(entry, field, None))

    cell = {}
    for key, field in (
        ("gender", definition["noun_gender"]),
        ("plural", definition["noun_plural"]),
        ("example", _example_field(definition)),
        ("pronunciation", _pronunciation_field(definition)),
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
    definition = GRAMMAR_DEFINITIONS.get(language)
    if definition is None:
        raise ValueError(f"No grammar definition for {language}.")
    try:
        cell = json.loads(value)
    except (TypeError, json.JSONDecodeError):
        raise ValueError(f"grammar_{language} must be a JSON object.") from None
    if not isinstance(cell, dict):
        raise ValueError(f"grammar_{language} must be a JSON object.")

    simple = {
        "gender": definition["noun_gender"],
        "plural": definition["noun_plural"],
        "example": _example_field(definition),
        "pronunciation": _pronunciation_field(definition),
        "adjective_gender": definition["adjective_gender"],
    }
    unknown = set(cell) - set(simple) - {"forms"}
    if unknown:
        raise ValueError(
            f"Unknown grammar field for {language}: " + ", ".join(sorted(unknown))
        )
    values = {}
    for key, field in simple.items():
        if key in cell:
            found = grammar_value(field, cell[key])
            if found is not None:
                if not isinstance(found, str):
                    raise ValueError(f"grammar_{language} values must be text.")
                if (
                    key in {"gender", "adjective_gender"}
                    and found not in definition["genders"]
                ):
                    raise ValueError(
                        f"Invalid {key} for {language}: {found}."
                    )
                values[field] = found
    forms = cell.get("forms", {})
    if not isinstance(forms, dict):
        raise ValueError(f"grammar_{language} forms must be a JSON object.")
    unknown_forms = set(forms) - set(definition["forms"])
    if unknown_forms:
        raise ValueError(
            f"Unknown grammar form for {language}: "
            + ", ".join(sorted(unknown_forms))
        )
    for key, found in forms.items():
        if found in (None, ""):
            continue
        if not isinstance(found, str):
            raise ValueError(f"grammar_{language} values must be text.")
        values[definition["forms"][key]] = found
    return values
