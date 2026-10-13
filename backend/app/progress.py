"""Review-history counts, independent of lasting mastery claims."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import distinct, func, select

from app.models import LearningProgress, Profile, ReviewEvent, VocabularyEntry
from app.practice import difficult_progress

RATINGS = ("again", "hard", "easy")
DIRECTIONS = ("greek_to_italian", "italian_to_greek")


def progress_router(sessions, gate):
    router = APIRouter(prefix="/api/profiles", dependencies=[Depends(gate.require)])

    @router.get("/{profile_id}/progress")
    def progress(profile_id: UUID):
        with sessions() as db:
            if db.get(Profile, profile_id) is None:
                raise HTTPException(404, "Learner profile not found.")
            history = ReviewEvent.profile_id == profile_id
            metrics = [
                func.count().label("total_reviews"),
                func.count(distinct(ReviewEvent.entry_id)).label("entries_practised"),
                *[
                    func.count().filter(ReviewEvent.rating == r).label(r)
                    for r in RATINGS
                ],
            ]

            def aggregate(*conditions):
                row = db.execute(select(*metrics).where(history, *conditions)).one()
                return output(row)

            def output(row):
                return {
                    "total_reviews": row.total_reviews,
                    "entries_practised": row.entries_practised,
                    "counts": {r: getattr(row, r) for r in RATINGS},
                }

            def breakdown(key):
                rows = db.execute(
                    select(key.label("key"), *metrics)
                    .where(history)
                    .group_by(key)
                    .order_by(key)
                ).all()
                return [{"key": row.key, **output(row)} for row in rows]

            difficult = (
                difficult_progress(profile_id, DIRECTIONS[0])
                .with_only_columns(
                    LearningProgress.entry_id, LearningProgress.direction
                )
                .union_all(
                    difficult_progress(profile_id, DIRECTIONS[1]).with_only_columns(
                        LearningProgress.entry_id, LearningProgress.direction
                    )
                )
                .subquery()
            )
            directions = [
                {
                    "key": direction,
                    **aggregate(ReviewEvent.direction == direction),
                    "difficult_entries": db.scalar(
                        select(func.count())
                        .select_from(difficult)
                        .where(difficult.c.direction == direction)
                    ),
                }
                for direction in DIRECTIONS
            ]
            recent = db.execute(
                select(
                    ReviewEvent.session_id,
                    func.max(ReviewEvent.created_at).label("last_reviewed_at"),
                )
                .where(history)
                .group_by(ReviewEvent.session_id)
                .order_by(
                    func.max(ReviewEvent.created_at).desc(), ReviewEvent.session_id
                )
                .limit(1)
            ).first()
            recent_session = None
            if recent:
                summary = aggregate(ReviewEvent.session_id == recent.session_id)
                recent_session = {
                    "id": str(recent.session_id),
                    "last_reviewed_at": recent.last_reviewed_at.isoformat(),
                    **summary,
                    "remembered": (
                        summary["counts"]["hard"] + summary["counts"]["easy"]
                    )
                    / summary["total_reviews"]
                    * 100,
                }
            # Snapshot dimensions retain the classification used during practice.
            unit = ReviewEvent.snapshot["unit"]["code"].as_string()
            unit_title = ReviewEvent.snapshot["unit"]["title"].as_string()
            unit_rows = db.execute(
                select(unit.label("key"), unit_title.label("title"), *metrics)
                .where(history)
                .group_by(unit, unit_title)
                .order_by(unit, unit_title)
            ).all()
            return {
                "vocabulary_count": db.scalar(
                    select(func.count()).select_from(VocabularyEntry)
                ),
                **aggregate(),
                "difficult_entries": db.scalar(
                    select(func.count(distinct(difficult.c.entry_id)))
                ),
                "directions": directions,
                "word_types": breakdown(ReviewEvent.snapshot["word_type"].as_string()),
                "units": [
                    {"key": row.key, "title": row.title, **output(row)}
                    for row in unit_rows
                ],
                "recent_session": recent_session,
            }

    return router
