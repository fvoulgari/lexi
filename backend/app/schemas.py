from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class UnitOutput(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    code: str
    title: str
    sort_order: int


class ProfileOutput(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    display_name: str
    preferred_direction: str
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
