"""Random queues retain their selected wording independently of library edits."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select

from app.filters import category_conditions
from app.models import (
    LearningProgress,
    PracticeSession,
    Profile,
    ReviewEvent,
    SessionCard,
    VocabularyEntry,
)
from app.schemas import RevealCard, ReviewCard, SessionCreate, VocabularyOutput


def practice_router(sessions, gate):
    router = APIRouter(prefix="/api/sessions", dependencies=[Depends(gate.require)])
    writes = [Depends(gate.check_csrf)]

    def find_session(db, session_id):
        session = db.get(PracticeSession, session_id)
        if session is None:
            raise HTTPException(404, "Practice session not found.")
        return session

    def session_output(db, session):
        cards = db.scalars(
            select(SessionCard)
            .where(SessionCard.session_id == session.id)
            .order_by(SessionCard.position)
        ).all()
        return {
            "id": str(session.id),
            "profile_id": str(session.profile_id),
            "direction": session.direction,
            "requested_size": session.requested_size,
            "available": session.available,
            "cards": [
                {
                    "position": c.position,
                    "entry_id": str(c.entry_id) if c.entry_id else None,
                    "snapshot": c.snapshot,
                }
                for c in cards
            ],
        }

    @router.post("", status_code=201, dependencies=writes)
    def create(body: SessionCreate):
        with sessions.begin() as db:
            if db.get(Profile, body.profile_id) is None:
                raise HTTPException(404, "Learner profile not found.")
            conditions = category_conditions(
                body.unit_ids, body.no_unit, body.word_types, body.tag_ids
            )
            available = db.scalar(
                select(func.count()).select_from(VocabularyEntry).where(*conditions)
            )
            if not available:
                raise HTTPException(
                    409,
                    detail={
                        "code": "no_matches",
                        "message": (
                            "No entries match. Clear filters or add vocabulary "
                            "and try again."
                        ),
                    },
                )
            entries = db.scalars(
                select(VocabularyEntry)
                .where(*conditions)
                .order_by(func.random())
                .limit(body.size)
            ).all()
            session = PracticeSession(
                profile_id=body.profile_id,
                direction=body.direction,
                requested_size=body.size,
                available=available,
            )
            db.add(session)
            db.flush()
            for position, entry in enumerate(entries):
                db.add(
                    SessionCard(
                        session_id=session.id,
                        position=position,
                        entry_id=entry.id,
                        snapshot=VocabularyOutput.model_validate(entry).model_dump(
                            mode="json"
                        ),
                    )
                )
            db.flush()
            return session_output(db, session)

    @router.get("/{session_id}")
    def read(session_id: UUID):
        with sessions() as db:
            return session_output(db, find_session(db, session_id))

    def locked_card(db, session_id, position):
        session = db.scalar(
            select(PracticeSession)
            .where(PracticeSession.id == session_id)
            .with_for_update()
        )
        if session is None:
            raise HTTPException(404, "Practice session not found.")
        card = db.get(SessionCard, (session_id, position))
        if card is None:
            raise HTTPException(404, "Session card not found.")
        return session, card

    def event_output(event):
        return {
            "id": str(event.id),
            "session_id": str(event.session_id),
            "position": event.position,
            "profile_id": str(event.profile_id),
            "entry_id": str(event.entry_id),
            "direction": event.direction,
            "rating": event.rating,
            "snapshot": event.snapshot,
            "created_at": event.created_at.isoformat(),
        }

    @router.post("/{session_id}/cards/{position}/reveal", dependencies=writes)
    def reveal(session_id: UUID, position: int, body: RevealCard):
        with sessions.begin() as db:
            _, card = locked_card(db, session_id, position)
            card.revealed_direction = body.direction
            return {"revealed": True}

    @router.post("/{session_id}/cards/{position}/reviews", dependencies=writes)
    def review(session_id: UUID, position: int, body: ReviewCard):
        with sessions.begin() as db:
            session, card = locked_card(db, session_id, position)
            existing = db.scalar(
                select(ReviewEvent).where(
                    ReviewEvent.session_id == session_id,
                    ReviewEvent.position == position,
                )
            )
            if existing:
                if (
                    existing.rating != body.rating
                    or existing.direction != body.direction
                ):
                    raise HTTPException(
                        409, "This card already has a different accepted review."
                    )
                return event_output(existing)
            if card.revealed_direction != body.direction:
                raise HTTPException(409, "Reveal this answer before rating it.")
            if card.entry_id is None:
                raise HTTPException(409, "This vocabulary entry was removed.")
            # Serialize aggregate updates across sessions for the same learner.
            db.scalar(
                select(Profile)
                .where(Profile.id == session.profile_id)
                .with_for_update()
            )
            entry = db.scalar(
                select(VocabularyEntry)
                .where(VocabularyEntry.id == card.entry_id)
                .with_for_update(of=VocabularyEntry)
            )
            if entry is None:
                raise HTTPException(409, "This vocabulary entry was removed.")
            event = ReviewEvent(
                session_id=session_id,
                position=position,
                profile_id=session.profile_id,
                entry_id=card.entry_id,
                direction=body.direction,
                rating=body.rating,
                snapshot=card.snapshot,
            )
            db.add(event)
            db.flush()
            key = (session.profile_id, card.entry_id, body.direction)
            progress = db.get(LearningProgress, key)
            if progress is None:
                progress = LearningProgress(
                    profile_id=session.profile_id,
                    entry_id=card.entry_id,
                    direction=body.direction,
                    reviews=0,
                    again=0,
                    hard=0,
                    easy=0,
                    weighted_sum=0,
                    weight=0,
                    last_reviewed_at=event.created_at,
                )
                db.add(progress)
            progress.reviews += 1
            setattr(progress, body.rating, getattr(progress, body.rating) + 1)
            progress.weighted_sum = (
                progress.weighted_sum * 0.8
                + {"again": 1, "hard": 0.5, "easy": 0}[body.rating]
            )
            progress.weight = progress.weight * 0.8 + 1
            progress.last_reviewed_at = event.created_at
            return event_output(event)

    @router.get("/{session_id}/summary")
    def summary(session_id: UUID):
        with sessions() as db:
            find_session(db, session_id)
            events = db.scalars(
                select(ReviewEvent)
                .where(ReviewEvent.session_id == session_id)
                .order_by(ReviewEvent.position)
            ).all()
            counts = {
                rating: sum(e.rating == rating for e in events)
                for rating in ("again", "hard", "easy")
            }
            return {
                "total": len(events),
                "counts": counts,
                "remembered": (counts["hard"] + counts["easy"]) / len(events) * 100
                if events
                else 0,
                "needs_practice": [
                    event_output(e) for e in events if e.rating != "easy"
                ],
            }

    return router
