"""Configuration-driven optional grammar keyed by language ID.

``grammar_definitions.json`` is the single definition of every enhanced
language's fields, types, options and conditions. The historical
``italian_*``/``greek_*`` columns remain compatibility storage, while one
``grammar`` JSON column is the structured store for all enhanced languages.
Both are derived from the same definitions: there are no per-pair branches and
no universal linguistic engine.
"""

import json
from collections.abc import Mapping, Sequence
from pathlib import Path

DEFINITION_FILE = Path(__file__).with_name("grammar_definitions.json")
DEFINITIONS = json.loads(DEFINITION_FILE.read_text(encoding="utf-8"))
WORD_TYPES = tuple(DEFINITIONS["word_types"])


def _adapt(language, definition):
    """Expose the schema in the shape existing callers and the UI expect."""
    fields = definition["fields"]
    return {
        "legacy_name": definition["legacy_name"],
        "genders": tuple(definition["genders"]),
        "schema": fields,
        "noun_gender": fields["gender"]["storage"],
        "noun_plural": fields["plural"]["storage"],
        "adjective_gender": fields["adjective_gender"]["storage"],
        "example": fields["example"]["storage"],
        "pronunciation": fields["pronunciation"]["storage"],
        "forms": {
            name: spec["storage"] for name, spec in fields["forms"].items()
        },
    }


GRAMMAR_DEFINITIONS = {
    language: _adapt(language, definition)
    for language, definition in DEFINITIONS["languages"].items()
}

NOUN_GENDER_FIELDS = {
    language: definition["noun_gender"]
    for language, definition in GRAMMAR_DEFINITIONS.items()
}
NOUN_PLURAL_FIELDS = {
    language: definition["noun_plural"]
    for language, definition in GRAMMAR_DEFINITIONS.items()
}
ADJECTIVE_GENDER_FIELDS_BY_LANGUAGE = {
    language: definition["adjective_gender"]
    for language, definition in GRAMMAR_DEFINITIONS.items()
}
ADJECTIVE_FORM_FIELDS_BY_LANGUAGE = {
    language: dict(definition["forms"])
    for language, definition in GRAMMAR_DEFINITIONS.items()
}
GENDERS_BY_LANGUAGE = {
    language: definition["genders"]
    for language, definition in GRAMMAR_DEFINITIONS.items()
}

# Derived legacy constants keep snapshots and existing callers in their
# historical order while the definitions above own the mapping.
NOUN_FIELDS = tuple(NOUN_GENDER_FIELDS.values()) + tuple(
    NOUN_PLURAL_FIELDS.values()
)
ADJECTIVE_FORM_FIELDS = tuple(
    ADJECTIVE_FORM_FIELDS_BY_LANGUAGE["it"].values()
) + tuple(ADJECTIVE_FORM_FIELDS_BY_LANGUAGE["el"].values())
ADJECTIVE_GENDER_FIELDS = tuple(ADJECTIVE_GENDER_FIELDS_BY_LANGUAGE.values())
ADJECTIVE_FIELDS = ADJECTIVE_FORM_FIELDS + ADJECTIVE_GENDER_FIELDS


class _GrammarFields(Sequence):
    """Live view of legacy storage columns, including test-only definitions."""

    def __iter__(self):
        for language in grammar_languages():
            definition = GRAMMAR_DEFINITIONS[language]
            yield definition["noun_gender"]
            yield definition["noun_plural"]
            yield definition["adjective_gender"]
            yield from definition["forms"].values()

    def __len__(self):
        return sum(1 for _ in self)

    def __getitem__(self, index):
        return tuple(self)[index]


GRAMMAR_FIELDS = _GrammarFields()


def register_grammar_definition(language, definition):
    """Add a test-only definition. No column, migration or UI change needed."""
    DEFINITIONS["languages"][language] = definition
    GRAMMAR_DEFINITIONS[language] = _adapt(language, definition)
    adapted = GRAMMAR_DEFINITIONS[language]
    NOUN_GENDER_FIELDS[language] = adapted["noun_gender"]
    NOUN_PLURAL_FIELDS[language] = adapted["noun_plural"]
    ADJECTIVE_GENDER_FIELDS_BY_LANGUAGE[language] = adapted["adjective_gender"]
    ADJECTIVE_FORM_FIELDS_BY_LANGUAGE[language] = dict(adapted["forms"])
    GENDERS_BY_LANGUAGE[language] = adapted["genders"]


def unregister_grammar_definition(language):
    """Remove a definition registered by a test."""
    for mapping in (
        DEFINITIONS["languages"],
        GRAMMAR_DEFINITIONS,
        NOUN_GENDER_FIELDS,
        NOUN_PLURAL_FIELDS,
        ADJECTIVE_GENDER_FIELDS_BY_LANGUAGE,
        ADJECTIVE_FORM_FIELDS_BY_LANGUAGE,
        GENDERS_BY_LANGUAGE,
    ):
        mapping.pop(language, None)


def structured_storage_fields():
    """Every legacy column a structured field can map to, in config order."""
    for definition in GRAMMAR_DEFINITIONS.values():
        for _, spec in iter_fields(definition):
            yield spec["storage"]


def grammar_languages(languages=None):
    """Card language IDs that have a grammar definition, in config order."""
    if languages is None:
        return tuple(GRAMMAR_DEFINITIONS)
    return tuple(language for language in GRAMMAR_DEFINITIONS if language in languages)


def iter_fields(definition):
    """Yield ``(path, spec)`` for every field in one language definition."""
    fields = definition["schema"]
    for name, spec in fields.items():
        if name == "forms":
            for form, form_spec in spec.items():
                yield f"forms.{form}", form_spec
        else:
            yield name, spec


def _value(source, field):
    if isinstance(source, Mapping):
        return source.get(field)
    return getattr(source, field, None)


def language_grammar_fields(language, word_type=None):
    """Compatibility columns backing one language definition."""
    definition = GRAMMAR_DEFINITIONS[language]
    noun = (definition["noun_gender"], definition["noun_plural"])
    adjective = (
        definition["adjective_gender"],
        *definition["forms"].values(),
    )
    if word_type == "noun":
        return noun
    if word_type == "adjective":
        return adjective
    if word_type is None:
        return noun + adjective
    return ()


def grammar_fields(languages=None, word_type=None):
    """Every grammar column relevant to these language IDs and word type."""
    return tuple(
        field
        for language in grammar_languages(languages)
        for field in language_grammar_fields(language, word_type)
    )


def incompatible_fields(word_type, languages=None):
    allowed = set(grammar_fields(languages, word_type))
    return tuple(field for field in GRAMMAR_FIELDS if field not in allowed)


def clean_grammar(values, word_type, languages=None):
    return {**values, **dict.fromkeys(incompatible_fields(word_type, languages))}


def required_gender_fields(word_type, languages=None):
    languages = grammar_languages(languages)
    if word_type == "noun":
        return tuple(NOUN_GENDER_FIELDS[language] for language in languages)
    if word_type == "adjective":
        return tuple(
            ADJECTIVE_GENDER_FIELDS_BY_LANGUAGE[language] for language in languages
        )
    return ()


def missing_gender_fields(values, languages=None):
    return [
        field
        for field in required_gender_fields(values.get("word_type"), languages)
        if not values.get(field) or values[field] == "common"
    ]


def invalid_grammar_fields(values, languages=None):
    """Compatibility gender values a language definition does not allow."""
    invalid = []
    for language in grammar_languages(languages):
        options = set(GRAMMAR_DEFINITIONS[language]["genders"])
        for field in (
            NOUN_GENDER_FIELDS[language],
            ADJECTIVE_GENDER_FIELDS_BY_LANGUAGE[language],
        ):
            value = values.get(field)
            if value and value not in options:
                invalid.append(field)
    return invalid


def gender_field_language(field):
    """Language ID behind a legacy gender column, for validation messages."""
    for language, definition in GRAMMAR_DEFINITIONS.items():
        if field in (definition["noun_gender"], definition["adjective_gender"]):
            return language
    return None


def card_grammar_fields(card, languages=None):
    """Legacy-named grammar values for a card's defined language IDs only."""
    return {
        field: _value(card, field)
        for field in grammar_fields(languages)
        if _value(card, field) is not None
    }


def _nested(cell, path):
    if path.startswith("forms."):
        return (cell.get("forms") or {}).get(path.split(".", 1)[1])
    return cell.get(path)


def validate_structured_grammar(grammar, languages=None, word_type=None):
    """Validate a structured grammar mapping against the definitions.

    Returns actionable ``{"path", "message"}`` errors; an empty list means the
    value is safe to store. Unknown languages and fields, invalid options,
    overlong text and missing conditional values are all rejected.
    """
    if grammar is None:
        return []
    if not isinstance(grammar, Mapping):
        return [
            {
                "path": "grammar",
                "message": "Grammar must be an object keyed by language ID.",
            }
        ]
    allowed = set(grammar_languages(languages))
    errors = []
    for language, cell in grammar.items():
        path = f"grammar.{language}"
        if language not in allowed:
            errors.append(
                {"path": path, "message": f"No grammar definition for {language}."}
            )
            continue
        if not isinstance(cell, Mapping):
            errors.append({"path": path, "message": "Grammar must be an object."})
            continue
        definition = GRAMMAR_DEFINITIONS[language]
        specs = dict(iter_fields(definition))
        for name in cell:
            expected = f"forms.{name}" if name == "forms" else name
            if name == "forms":
                if not isinstance(cell[name], Mapping):
                    errors.append(
                        {"path": f"{path}.forms", "message": "Forms must be an object."}
                    )
                elif set(cell[name]) - set(definition["forms"]):
                    errors.append(
                        {
                            "path": f"{path}.forms",
                            "message": "Unknown form for "
                            f"{language}: "
                            + ", ".join(
                                sorted(set(cell[name]) - set(definition["forms"]))
                            )
                            + ".",
                        }
                    )
            elif expected not in specs:
                errors.append(
                    {
                        "path": f"{path}.{name}",
                        "message": f"Unknown grammar field for {language}: {name}.",
                    }
                )
        for field_path, spec in specs.items():
            value = _nested(cell, field_path)
            if value is None or value == "":
                if word_type and word_type in spec.get("required_for", ()):
                    errors.append(
                        {
                            "path": f"{path}.{field_path}",
                            "message": f"Choose {field_path} for {language}.",
                        }
                    )
                continue
            field_label = f"{path}.{field_path}"
            if not isinstance(value, str):
                errors.append(
                    {"path": field_label, "message": "Grammar values must be text."}
                )
                continue
            if any(ord(char) == 0 or 0xD800 <= ord(char) <= 0xDFFF for char in value):
                errors.append(
                    {
                        "path": field_label,
                        "message": "Text contains invalid Unicode characters.",
                    }
                )
                continue
            if spec["type"] == "enum" and value not in spec["options"]:
                errors.append(
                    {
                        "path": field_label,
                        "message": "Choose a listed value for "
                        f"{field_path}: "
                        + ", ".join(spec["options"])
                        + ".",
                    }
                )
            elif len(value) > spec.get("max_length", 10_000):
                errors.append(
                    {
                        "path": field_label,
                        "message": f"{field_path} is too long.",
                    }
                )
    return errors


def structured_from_legacy(values, languages=None):
    """Build the structured store from compatibility-column values."""
    structured = {}
    for language in grammar_languages(languages):
        definition = GRAMMAR_DEFINITIONS[language]
        cell = {}
        for field_path, spec in iter_fields(definition):
            value = _value(values, spec["storage"])
            if value is None or value in ("", "common"):
                continue
            if field_path.startswith("forms."):
                cell.setdefault("forms", {})[field_path.split(".", 1)[1]] = value
            else:
                cell[field_path] = value
        if cell:
            structured[language] = cell
    return structured


def legacy_from_structured(grammar, values=None, languages=None):
    """Merge validated structured values into compatibility-column values."""
    errors = validate_structured_grammar(grammar, languages)
    if errors:
        raise ValueError("; ".join(f"{e['path']}: {e['message']}" for e in errors))
    merged = dict(values or {})
    legacy = set(structured_storage_fields())
    for language, cell in (grammar or {}).items():
        for field_path, spec in iter_fields(GRAMMAR_DEFINITIONS[language]):
            value = _nested(cell, field_path)
            if value is None or value == "" or spec["storage"] not in legacy:
                continue
            merged[spec["storage"]] = value
    return merged


def merge_structured(base, incoming, languages=None):
    """Merge one structured grammar mapping into an existing stored mapping."""
    result = {language: dict(cell) for language, cell in (base or {}).items()}
    errors = validate_structured_grammar(incoming, languages)
    if errors:
        raise ValueError("; ".join(f"{e['path']}: {e['message']}" for e in errors))
    for language, cell in (incoming or {}).items():
        current = dict(result.get(language) or {})
        for key, value in cell.items():
            if key == "forms" and isinstance(value, Mapping):
                forms = dict(current.get("forms") or {})
                forms.update(
                    {
                        name: found
                        for name, found in value.items()
                        if found not in (None, "")
                    }
                )
                if forms:
                    current["forms"] = forms
            elif value not in (None, ""):
                current[key] = value
        if current:
            result[language] = current
        else:
            result.pop(language, None)
    return result or None


def apply_structured_input(values, languages, word_type, model):
    """Consume an API ``grammar`` field into validated legacy values.

    Returns ``(errors, structured)``. Callers keep the structured value for the
    ``sync_entry_grammar`` call after the model instance exists.
    """
    grammar = values.pop("grammar", None)
    errors = validate_structured_grammar(grammar, languages, word_type)
    if errors:
        return errors, None
    if grammar:
        merged = legacy_from_structured(grammar, values, languages)
        values.update(
            {key: value for key, value in merged.items() if hasattr(model, key)}
        )
    return [], grammar


def sync_entry_grammar(entry, incoming=None):
    """Keep one structured store and the legacy compatibility columns in step."""
    languages = (_value(entry, "source_language"), _value(entry, "target_language"))
    structured = dict(_value(entry, "grammar") or {})
    if incoming is not None:
        structured = merge_structured(structured, incoming, languages) or {}
    columns = set(structured_storage_fields())
    for language in grammar_languages(languages):
        definition = GRAMMAR_DEFINITIONS[language]
        cell = dict(structured.get(language) or {})
        for field_path, spec in iter_fields(definition):
            storage = spec["storage"]
            if storage in columns and hasattr(
                type(entry), "__table__"
            ) and storage in type(entry).__table__.columns:
                value = _value(entry, storage)
                if value is None or value in ("", "common"):
                    if field_path.startswith("forms."):
                        cell.get("forms", {}).pop(field_path.split(".", 1)[1], None)
                    else:
                        cell.pop(field_path, None)
                elif field_path.startswith("forms."):
                    cell.setdefault("forms", {})[field_path.split(".", 1)[1]] = value
                else:
                    cell[field_path] = value
        if "forms" in cell and not cell["forms"]:
            cell.pop("forms")
        if cell:
            structured[language] = cell
        else:
            structured.pop(language, None)
    entry.grammar = structured or None
    return entry.grammar
