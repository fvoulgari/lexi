from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import (
    BaseModel,
    ConfigDict,
    StringConstraints,
    field_validator,
    model_validator,
)


class UnitOutput(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    code: str
    title: str
    sort_order: int


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
    italian_example: str | None
    greek_example: str | None
    notes: str | None
    pronunciation: str | None
    created_at: datetime
    updated_at: datetime


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
Gender = Literal["masculine", "feminine", "neuter"]


class VocabularyFields(BaseModel):
    model_config = ConfigDict(extra="forbid")
    unit_id: UUID | None = None
    tag_ids: list[UUID] = []
    italian_gender: Gender | None = None
    greek_gender: Gender | None = None
    italian_plural: PluralText | None = None
    greek_plural: PluralText | None = None
    italian_example: OptionalText | None = None
    greek_example: OptionalText | None = None
    notes: OptionalText | None = None
    pronunciation: OptionalText | None = None

    @field_validator(
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
    italian: EntryText
    greek: EntryText
    word_type: WordType


class VocabularyUpdate(VocabularyFields):
    italian: EntryText | None = None
    greek: EntryText | None = None
    word_type: WordType | None = None

    @field_validator("italian", "greek", "word_type", mode="before")
    @classmethod
    def required_fields_cannot_be_null(cls, value):
        if value is None:
            raise ValueError("Italian, Greek and word type cannot be null.")
        return value


class VocabularySaved(BaseModel):
    entry: VocabularyOutput
    duplicate_ids: list[UUID]
