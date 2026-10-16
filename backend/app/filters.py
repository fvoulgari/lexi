"""Shared category selection for the vocabulary library and practice queues."""

from sqlalchemy import or_, select

from app.models import Tag, VocabularyEntry, profile_practice_units


def category_conditions(unit_ids, no_unit, word_types, tag_ids):
    conditions = []
    if unit_ids or no_unit:
        units = [VocabularyEntry.unit_id.in_(unit_ids)]
        if no_unit:
            units.append(VocabularyEntry.unit_id.is_(None))
        conditions.append(or_(*units))
    if word_types:
        conditions.append(VocabularyEntry.word_type.in_(word_types))
    if tag_ids:
        conditions.append(VocabularyEntry.tags.any(Tag.id.in_(tag_ids)))
    return conditions


def practice_scope(profile_id):
    """A saved empty selection deliberately matches nothing."""
    return VocabularyEntry.unit_id.in_(
        select(profile_practice_units.c.unit_id).where(
            profile_practice_units.c.profile_id == profile_id
        )
    )
