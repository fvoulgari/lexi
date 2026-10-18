"""Category-specific optional grammar; legacy records are cleaned only on save."""

NOUN_FIELDS = ("italian_gender", "greek_gender", "italian_plural", "greek_plural")
ADJECTIVE_FORM_FIELDS = (
    "italian_feminine_singular",
    "italian_masculine_plural",
    "italian_feminine_plural",
    "italian_masculine_singular",
    "greek_masculine_singular",
    "greek_masculine_plural",
    "greek_feminine_singular",
    "greek_feminine_plural",
    "greek_neuter_singular",
    "greek_neuter_plural",
)
ADJECTIVE_GENDER_FIELDS = ("italian_adjective_gender", "greek_adjective_gender")
ADJECTIVE_FIELDS = ADJECTIVE_FORM_FIELDS + ADJECTIVE_GENDER_FIELDS
GRAMMAR_FIELDS = NOUN_FIELDS + ADJECTIVE_FIELDS


def incompatible_fields(word_type):
    allowed = (
        NOUN_FIELDS
        if word_type == "noun"
        else (ADJECTIVE_FIELDS if word_type == "adjective" else ())
    )
    return tuple(field for field in GRAMMAR_FIELDS if field not in allowed)


def clean_grammar(values, word_type):
    return {**values, **dict.fromkeys(incompatible_fields(word_type))}


def required_gender_fields(word_type):
    if word_type == "noun":
        return ("italian_gender", "greek_gender")
    if word_type == "adjective":
        return ADJECTIVE_GENDER_FIELDS
    return ()


def missing_gender_fields(values):
    return [
        field
        for field in required_gender_fields(values.get("word_type"))
        if not values.get(field) or values[field] == "common"
    ]
