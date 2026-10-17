"""Shared category selection for the vocabulary library and practice queues."""

from sqlalchemy import or_

from app.models import Tag, VocabularyEntry


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


def vocabulary_conditions(q, unit_ids, no_unit, word_types, tag_ids):
    conditions = category_conditions(unit_ids, no_unit, word_types, tag_ids)
    if q.strip():
        pattern = (
            "%"
            + q.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            + "%"
        )
        conditions.append(
            or_(
                VocabularyEntry.italian.ilike(pattern, escape="\\"),
                VocabularyEntry.greek.ilike(pattern, escape="\\"),
            )
        )
    return conditions
