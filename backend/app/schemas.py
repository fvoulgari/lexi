from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, StringConstraints, model_validator


class UnitOutput(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    code: str
    title: str
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


class VocabularyOutput(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    italian: str
    greek: str
    word_type: str
    unit: UnitOutput | None
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
