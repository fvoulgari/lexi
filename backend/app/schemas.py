from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    ValidationError,
    field_validator,
    model_validator,
)

from app.grammar import clean_grammar, missing_gender_fields


class UnitOutput(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    code: str
    title: str
    sort_order: int
    card_count: int = 0


class UnitCreate(BaseModel):
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
Direction = Literal["greek_to_italian", "italian_to_greek"]
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
    model_config = ConfigDict(extra="forbid")
    name: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)
    ]


class TagOutput(TagCreate):
    model_config = ConfigDict(from_attributes=True)
    id: UUID


class VocabularyOutput(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    italian: str
    greek: str
    word_type: str
    unit: UnitOutput | None
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


class VocabularyFields(BaseModel):
    model_config = ConfigDict(extra="forbid")
    unit_id: UUID | None = None
    tag_ids: list[UUID] = []
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

    @model_validator(mode="before")
    @classmethod
    def discard_incompatible_grammar(cls, values):
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


class VocabularyCreate(VocabularyFields):
    unit_id: UUID
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


class VocabularyUpdate(VocabularyFields):
    italian: EntryText | None = None
    greek: EntryText | None = None
    word_type: WordType | None = None

    @field_validator("italian", "greek", "word_type", "unit_id", mode="before")
    @classmethod
    def required_fields_cannot_be_null(cls, value):
        if value is None:
            raise ValueError("Italian, Greek and word type cannot be null.")
        return value


class VocabularyBulk(BaseModel):
    model_config = ConfigDict(extra="forbid")
    action: Literal["move", "delete"]
    entry_ids: list[UUID] = Field(min_length=1)
    unit_id: UUID | None = None

    @model_validator(mode="after")
    def destination_for_move_only(self):
        if (self.action == "move") != (self.unit_id is not None):
            raise ValueError("Moving requires a destination unit; deletion does not.")
        return self


class VocabularySaved(BaseModel):
    entry: VocabularyOutput
    duplicate_ids: list[UUID]


class SessionCreate(BaseModel):
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
