"""Shared category selection for the vocabulary library and practice queues."""

from sqlalchemy import or_, select

from app.models import Collection, CollectionEntry, Tag, VocabularyEntry


def category_conditions(unit_ids, no_unit, word_types, tag_ids):
    conditions = []
    if unit_ids or no_unit:
        # During the transition an old Unit ID can identify its mapped
        # Collection. Include cards added to that Collection after migration,
        # even when they have no legacy unit_id of their own.
        mapped_cards = (
            select(CollectionEntry.entry_id)
            .join(Collection, Collection.id == CollectionEntry.collection_id)
            .where(Collection.source_unit_id.in_(unit_ids))
        )
        units = [VocabularyEntry.id.in_(mapped_cards)]
        if no_unit:
            units.append(
                ~VocabularyEntry.id.in_(
                    select(CollectionEntry.entry_id).join(
                        Collection, Collection.id == CollectionEntry.collection_id
                    )
                )
            )
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
