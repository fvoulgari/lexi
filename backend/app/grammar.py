"""Common card fields and optional grammar definitions keyed by language ID.

The historical ``italian_*``/``greek_*`` columns remain the compatibility
storage for these definitions. Definitions are keyed by language ID so a card's
own IDs decide which grammar applies; no new language-named text column is
introduced and languages without a definition use common fields only.
"""

from collections.abc import Mapping

# Languages with an optional grammar definition. Other registry languages use
# the common card fields alone.
GRAMMAR_LANGUAGES = ("it", "el")

NOUN_GENDER_FIELDS = {"it": "italian_gender", "el": "greek_gender"}
NOUN_PLURAL_FIELDS = {"it": "italian_plural", "el": "greek_plural"}
ADJECTIVE_GENDER_FIELDS_BY_LANGUAGE = {
    "it": "italian_adjective_gender",
    "el": "greek_adjective_gender",
}
ADJECTIVE_FORM_FIELDS_BY_LANGUAGE = {
    "it": {
        "feminine_singular": "italian_feminine_singular",
        "masculine_plural": "italian_masculine_plural",
        "feminine_plural": "italian_feminine_plural",
        "masculine_singular": "italian_masculine_singular",
    },
    "el": {
        "masculine_singular": "greek_masculine_singular",
        "masculine_plural": "greek_masculine_plural",
        "feminine_singular": "greek_feminine_singular",
        "feminine_plural": "greek_feminine_plural",
        "neuter_singular": "greek_neuter_singular",
        "neuter_plural": "greek_neuter_plural",
    },
}
GENDERS_BY_LANGUAGE = {
    "it": ("masculine", "feminine"),
    "el": ("masculine", "feminine", "neuter"),
}

GRAMMAR_DEFINITIONS = {
    language: {
        "genders": GENDERS_BY_LANGUAGE[language],
        "noun_gender": NOUN_GENDER_FIELDS[language],
        "noun_plural": NOUN_PLURAL_FIELDS[language],
        "adjective_gender": ADJECTIVE_GENDER_FIELDS_BY_LANGUAGE[language],
        "forms": ADJECTIVE_FORM_FIELDS_BY_LANGUAGE[language],
    }
    for language in GRAMMAR_LANGUAGES
}

# Derived legacy constants keep CSV columns, snapshots and existing callers in
# their historical order while the definitions above own the mapping.
NOUN_FIELDS = tuple(NOUN_GENDER_FIELDS.values()) + tuple(
    NOUN_PLURAL_FIELDS.values()
)
ADJECTIVE_FORM_FIELDS = tuple(
    ADJECTIVE_FORM_FIELDS_BY_LANGUAGE["it"].values()
) + tuple(ADJECTIVE_FORM_FIELDS_BY_LANGUAGE["el"].values())
ADJECTIVE_GENDER_FIELDS = tuple(ADJECTIVE_GENDER_FIELDS_BY_LANGUAGE.values())
ADJECTIVE_FIELDS = ADJECTIVE_FORM_FIELDS + ADJECTIVE_GENDER_FIELDS
GRAMMAR_FIELDS = NOUN_FIELDS + ADJECTIVE_FIELDS


def grammar_languages(languages=None):
    """Card language IDs that have a grammar definition, in registry order."""
    if languages is None:
        return GRAMMAR_LANGUAGES
    return tuple(language for language in GRAMMAR_LANGUAGES if language in languages)


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
        genders = GRAMMAR_DEFINITIONS[language]["genders"]
        for field in (
            NOUN_GENDER_FIELDS[language],
            ADJECTIVE_GENDER_FIELDS_BY_LANGUAGE[language],
        ):
            value = values.get(field)
            if value and value not in genders:
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

    def value(field):
        if isinstance(card, Mapping):
            return card.get(field)
        return getattr(card, field, None)

    return {
        field: value(field)
        for field in grammar_fields(languages)
        if value(field) is not None
    }
