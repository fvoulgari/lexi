from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    ValidationError,
    field_validator,
    model_validator,
)

from app.grammar import clean_grammar, missing_gender_fields
from app.languages import direction_languages


def _valid_direction(value):
    try:
        direction_languages(value)
    except ValueError as exc:
        raise ValueError(str(exc)) from exc
    return value


class UnitOutput(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    code: str
    title: str
    sort_order: int
    card_count: int = 0
    visibility: str = "legacy"
    can_edit: bool = False


class UnitCreate(BaseModel):
    visibility: Literal["private", "legacy", "published"] = "private"
    model_config = ConfigDict(extra="forbid")
    code: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=20)
    ]
    title: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=160)
    ]
    sort_order: int


ProfileName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)
]

Direction = Annotated[str, AfterValidator(_valid_direction)]
SessionSize = Literal[10, 25, 50] | None


class ProfileCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    display_name: ProfileName
    preferred_direction: Direction = "greek_to_italian"
    default_session_size: SessionSize = 25


class ProfileUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    display_name: ProfileName | None = None
    preferred_direction: Direction | None = None
    default_session_size: SessionSize | None = None

    @model_validator(mode="after")
    def reject_explicit_null(self):
        if any(
            getattr(self, field) is None
            for field in self.model_fields_set - {"default_session_size"}
        ):
            raise ValueError("Profile fields cannot be null.")
        return self


class ProfileOutput(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    display_name: str
    preferred_direction: Direction
    default_session_size: SessionSize
    created_at: datetime


class TagCreate(BaseModel):
    visibility: Literal["private", "legacy", "published"] = "private"
    model_config = ConfigDict(extra="forbid")
    name: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)
    ]


class TagOutput(TagCreate):
    can_edit: bool = False
    model_config = ConfigDict(from_attributes=True)
    id: UUID


class VocabularyOutput(BaseModel):
    visibility: str = "legacy"
    owner_account_id: UUID | None = None
    archived_at: datetime | None = None
    source_language: str = "it"
    target_language: str = "el"
    can_edit: bool = False
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    italian: str
    greek: str
    word_type: str
    unit: UnitOutput | None = None
    tags: list[TagOutput]
    italian_gender: str | None
    greek_gender: str | None
    italian_plural: str | None
    greek_plural: str | None
    italian_feminine_singular: str | None
    italian_masculine_plural: str | None
    italian_feminine_plural: str | None
    italian_example: str | None
    greek_example: str | None
    notes: str | None
    italian_masculine_singular: str | None
    greek_masculine_singular: str | None
    greek_masculine_plural: str | None
    greek_feminine_singular: str | None
    greek_feminine_plural: str | None
    greek_neuter_singular: str | None
    greek_neuter_plural: str | None
    italian_adjective_gender: str | None
    greek_adjective_gender: str | None
    greek_pronunciation: str | None
    pronunciation: str | None
    grammar: dict | None = None
    created_at: datetime
    updated_at: datetime

    @field_validator("italian_gender", "greek_gender", mode="before")
    @classmethod
    def legacy_common_is_unset(cls, value):
        # Reading old cards/snapshots must never guess gender from their article.
        return None if value == "common" else value


class VocabularyPage(BaseModel):
    items: list[VocabularyOutput]
    total: int
    page: int
    page_size: int


EntryText = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)
]
OptionalText = Annotated[
    str, StringConstraints(strip_whitespace=True, max_length=10000)
]
PluralText = Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)]
WordType = Literal["noun", "verb", "adjective", "adverb", "expression", "other"]
ItalianGender = Literal["masculine", "feminine"]
GreekGender = Literal["masculine", "feminine", "neuter"]


class GrammarFields(BaseModel):
    """Optional grammar values, stored in legacy language-named columns."""

    model_config = ConfigDict(extra="forbid")
    italian_gender: ItalianGender | None = None
    greek_gender: GreekGender | None = None
    italian_plural: PluralText | None = None
    greek_plural: PluralText | None = None
    italian_feminine_singular: PluralText | None = None
    italian_masculine_plural: PluralText | None = None
    italian_feminine_plural: PluralText | None = None
    italian_example: OptionalText | None = None
    greek_example: OptionalText | None = None
    notes: OptionalText | None = None
    italian_masculine_singular: PluralText | None = None
    greek_masculine_singular: PluralText | None = None
    greek_masculine_plural: PluralText | None = None
    greek_feminine_singular: PluralText | None = None
    greek_feminine_plural: PluralText | None = None
    greek_neuter_singular: PluralText | None = None
    greek_neuter_plural: PluralText | None = None
    italian_adjective_gender: ItalianGender | None = None
    greek_adjective_gender: GreekGender | None = None
    greek_pronunciation: OptionalText | None = None
    pronunciation: OptionalText | None = None
    # Structured store for enhanced languages. Values are validated against
    # the grammar definitions once the card's language IDs are known.
    grammar: dict[str, dict] | None = None

    @classmethod
    def clean_grammar_input(cls, values):
        if isinstance(values, dict) and values.get("word_type"):
            return clean_grammar(values, values["word_type"])
        return values

    @field_validator(
        "italian_masculine_singular",
        "greek_masculine_singular",
        "greek_masculine_plural",
        "greek_feminine_singular",
        "greek_feminine_plural",
        "greek_neuter_singular",
        "greek_neuter_plural",
        "greek_pronunciation",
        "italian_feminine_singular",
        "italian_masculine_plural",
        "italian_feminine_plural",
        "italian_plural",
        "greek_plural",
        "italian_example",
        "greek_example",
        "notes",
        "pronunciation",
    )
    @classmethod
    def empty_optional_text(cls, value):
        return value or None

    @field_validator("*", mode="before")
    @classmethod
    def reject_invalid_text(cls, value):
        if isinstance(value, str) and any(
            ord(char) == 0 or 0xD800 <= ord(char) <= 0xDFFF for char in value
        ):
            raise ValueError("Text contains invalid Unicode characters.")
        return value


class VocabularyFields(GrammarFields):
    unit_id: UUID | None = None
    tag_ids: list[UUID] = []

    @model_validator(mode="before")
    @classmethod
    def discard_incompatible_grammar(cls, values):
        return cls.clean_grammar_input(values)


class VocabularyCreate(VocabularyFields):
    visibility: Literal["private", "legacy", "published"] = "private"
    unit_id: UUID | None = None
    italian: EntryText
    greek: EntryText
    word_type: WordType

    @model_validator(mode="after")
    def require_entry_genders(self):
        missing = missing_gender_fields(self.model_dump())
        if missing:
            raise ValidationError.from_exception_data(
                type(self).__name__,
                [
                    {
                        "type": "value_error",
                        "loc": (field,),
                        "input": getattr(self, field),
                        "ctx": {
                            "error": ValueError(
                                "Choose the entry's gender for "
                                + (
                                    "Italian."
                                    if field.startswith("italian")
                                    else "Greek."
                                )
                            )
                        },
                    }
                    for field in missing
                ],
            )
        return self


class VocabularyCreateRequest(VocabularyCreate):
    # Older CSV/API clients may still supply a unit. New cards are grouped by
    # collection, with an internal unit retained for historical compatibility.
    unit_id: UUID | None = None
    collection_id: UUID | None = None
    confirm_collection_exposure: bool = False


class VocabularyUpdate(VocabularyFields):
    italian: EntryText | None = None
    greek: EntryText | None = None
    word_type: WordType | None = None
    # Accepted only to reject an attempted language-ID change with an explicit
    # error; a different pair requires a new card.
    source_language: str | None = None
    target_language: str | None = None

    @field_validator("italian", "greek", "word_type", "unit_id", mode="before")
    @classmethod
    def required_fields_cannot_be_null(cls, value):
        if value is None:
            raise ValueError("Italian, Greek and word type cannot be null.")
        return value

    @model_validator(mode="after")
    def card_language_ids_are_immutable(self):
        if self.source_language is not None or self.target_language is not None:
            raise ValueError("Card language IDs cannot be changed after creation.")
        return self


class VocabularyBulk(BaseModel):
    model_config = ConfigDict(extra="forbid")
    action: Literal["move", "delete", "add_to_collection"]
    entry_ids: list[UUID] = Field(min_length=1)
    unit_id: UUID | None = None
    collection_id: UUID | None = None

    @model_validator(mode="after")
    def destination_for_move_only(self):
        if (self.action == "move") != (self.unit_id is not None):
            raise ValueError("Moving requires a destination unit; deletion does not.")
        if (self.action == "add_to_collection") != (self.collection_id is not None):
            raise ValueError("Adding requires a destination collection.")
        return self


class VocabularySaved(BaseModel):
    entry: VocabularyOutput
    duplicate_ids: list[UUID]


class SessionCreate(BaseModel):
    collection_id: UUID | None = None
    collection_ids: list[UUID] = Field(default_factory=list, max_length=100)
    mode: Literal["random", "difficult", "mixed"] = "random"
    model_config = ConfigDict(extra="forbid")
    profile_id: UUID
    direction: Direction
    size: SessionSize = 25
    unit_ids: list[UUID] = []
    no_unit: bool = False
    word_types: list[WordType] = []
    tag_ids: list[UUID] = []


class RevealCard(BaseModel):
    model_config = ConfigDict(extra="forbid")
    direction: Direction


class ReviewCard(RevealCard):
    rating: Literal["again", "hard", "easy"]
