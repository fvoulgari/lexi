"""Delete card history and aggregates while the caller holds entry row locks."""

from sqlalchemy import delete

from app.models import LearningProgress, ReviewEvent, VocabularyEntry


def delete_entries(db, ids):
    # All learners and both directions: no deleted card may remain in statistics.
    for model in (LearningProgress, ReviewEvent, VocabularyEntry):
        db.execute(
            delete(model).where(
                (model.id if model is VocabularyEntry else model.entry_id).in_(ids)
            )
        )
