"""Ordinary deletion archives content without changing any learner history."""

from datetime import datetime, timezone

from sqlalchemy import select

from app.access import require_write
from app.models import VocabularyEntry


def delete_entries(db, ids):
    entries = list(
        db.scalars(
            select(VocabularyEntry)
            .where(VocabularyEntry.id.in_(ids))
            .execution_options(include_archived=True)
        )
    )
    for entry in entries:
        require_write(entry)
    for entry in entries:
        entry.archived_at = datetime.now(timezone.utc)
