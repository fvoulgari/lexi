"""Database-backed language registry: one source of truth for validation and UI.

The tables are loaded into an immutable snapshot for request handling. The
snapshot is refreshed from the database for every request, so inserting a new
language is a data change with no code or migration change. Curation is a
separate flag on the same row: registered languages remain usable internally
without being advertised in the public catalogue.
"""

from collections.abc import Mapping
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.engine import Connection
from sqlalchemy.orm import Session

from app.models import Language, PracticeDirection


@dataclass(frozen=True)
class LanguageInfo:
    id: str
    label: str
    script: str
    text_direction: str
    publicly_available: bool
    enhanced: bool

    def public_payload(self):
        return {
            "id": self.id,
            "label": self.label,
            "script": self.script,
            "text_direction": self.text_direction,
            "enhanced": self.enhanced,
        }


@dataclass(frozen=True)
class DirectionInfo:
    key: str
    prompt: str
    answer: str
    legacy: bool

    def public_payload(self):
        return {
            "key": self.key,
            "prompt_language": self.prompt,
            "answer_language": self.answer,
            "legacy": self.legacy,
        }


@dataclass(frozen=True)
class Registry:
    languages: Mapping[str, LanguageInfo]
    directions: Mapping[str, DirectionInfo]

    @property
    def ids(self):
        return tuple(sorted(self.languages))

    def public_languages(self):
        return tuple(
            sorted(
                (
                    language
                    for language in self.languages.values()
                    if language.publicly_available
                ),
                key=lambda language: language.id,
            )
        )

    def public_directions(self):
        public_ids = {language.id for language in self.public_languages()}
        return tuple(
            sorted(
                (
                    direction
                    for direction in self.directions.values()
                    if direction.prompt in public_ids and direction.answer in public_ids
                ),
                key=lambda direction: direction.key,
            )
        )

    def has_language(self, code):
        return code in self.languages

    def label(self, code):
        language = self.languages.get(code)
        return language.label if language else str(code)

    def catalogued(self, code):
        language = self.languages.get(code)
        return bool(language and language.publicly_available)

    def invalid_pair_message(self):
        labels = ", ".join(language.label for language in self.public_languages())
        return f"Choose two different supported languages: {labels}."

    def validate_pair(self, first, second):
        if (
            not self.has_language(first)
            or not self.has_language(second)
            or first == second
        ):
            raise ValueError(self.invalid_pair_message())
        return tuple(sorted((first, second)))

    def direction(self, key):
        direction = self.directions.get(key)
        if direction is None:
            raise ValueError("Unsupported practice direction.")
        return direction

    def direction_languages(self, key):
        direction = self.direction(key)
        return direction.prompt, direction.answer

    def direction_for(self, prompt, answer):
        candidates = [
            direction
            for direction in self.directions.values()
            if (direction.prompt, direction.answer) == (prompt, answer)
        ]
        if not candidates:
            raise ValueError(self.invalid_pair_message())
        conventional = f"{prompt}_to_{answer}"
        for direction in candidates:
            if direction.key == conventional:
                return direction.key
        return min(candidates, key=lambda direction: direction.key).key

    def pair_directions(self, first, second):
        """Both directed keys for one unordered pair, in a stable order."""
        source, target = self.validate_pair(first, second)
        return self.direction_for(source, target), self.direction_for(target, source)

    def is_legacy_direction(self, key):
        return self.direction(key).legacy


def load_registry(db: Session | Connection) -> Registry:
    # Core table selects work with both a Session and a raw Connection, so the
    # same loader serves requests, startup and tests that insert registry rows.
    languages = {
        row.id: LanguageInfo(
            id=row.id,
            label=row.display_name,
            script=row.script,
            text_direction=row.text_direction,
            publicly_available=row.publicly_available,
            enhanced=row.enhanced,
        )
        for row in db.execute(select(Language.__table__))
    }
    directions = {
        row.name: DirectionInfo(
            key=row.name,
            prompt=row.prompt_language,
            answer=row.answer_language,
            legacy=row.legacy,
        )
        for row in db.execute(select(PracticeDirection.__table__))
    }
    return Registry(languages=languages, directions=directions)


_current: Registry | None = None


def set_registry(registry: Registry):
    global _current
    _current = registry


def get_registry() -> Registry:
    if _current is None:
        raise RuntimeError("The language registry has not been loaded.")
    return _current


def refresh_registry(db: Session | Connection) -> Registry:
    registry = load_registry(db)
    set_registry(registry)
    return registry
