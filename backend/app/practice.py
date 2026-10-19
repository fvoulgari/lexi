"""Random queues retain their selected wording independently of library edits."""

from datetime import datetime, timedelta, timezone
from random import shuffle
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


def difficult_progress(profile_id, direction):
    """Eligibility uses accepted reviews only, with no time-based decay."""
    return select(LearningProgress).where(
        LearningProgress.profile_id == profile_id,
        LearningProgress.direction == direction,
        LearningProgress.reviews > 0,
        LearningProgress.weight > 0,
        LearningProgress.weighted_sum >= 0.5 * LearningProgress.weight,
    )


def mixed_entries(db, selection, profile_id, direction, size):
    """Largest remainders; ties prefer difficult, recent, then random."""
    entries = list(db.scalars(selection.order_by(func.random())).all())
    count = min(size, len(entries)) if size is not None else len(entries)
    quotas = [count * percent // 10 for percent in (4, 3, 3)]
    priority = sorted(range(3), key=lambda i: (-(count * (4, 3, 3)[i] % 10), i))
    for i in priority[: count - sum(quotas)]:
        quotas[i] += 1
    difficult = set(
        db.scalars(
            difficult_progress(profile_id, direction).with_only_columns(
                LearningProgress.entry_id
            )
        )
    )
    now = datetime.now(timezone.utc)
    recent = set(
        db.scalars(
            select(LearningProgress.entry_id).where(
                LearningProgress.profile_id == profile_id,
                LearningProgress.direction == direction,
                LearningProgress.reviews > 0,
                LearningProgress.last_reviewed_at >= now - timedelta(days=7),
                LearningProgress.last_reviewed_at <= now,
            )
        )
    )
    selected = []
    used = set()
    for pool, quota in ((difficult, quotas[0]), (recent, quotas[1])):
        candidates = [e for e in entries if e.id in pool and e.id not in used]
        chosen = candidates[:quota]
        selected.extend(chosen)
        used.update(e.id for e in chosen)
    selected.extend(e for e in entries if e.id not in used)
    selected = selected[:count]
    shuffle(selected)
    return selected


def practice_router(sessions, gate):
    router = APIRouter(prefix="/api/sessions", dependencies=[Depends(gate.require)])
    writes = [Depends(gate.check_csrf)]

    def require_profile(db, profile_id):
        profile = db.scalar(
            select(Profile).where(Profile.id == profile_id).with_for_update()
        )
        if profile is None:
            raise HTTPException(
                404,
                detail={
                    "code": "profile_not_found",
                    "message": "Learner profile not found. Choose another profile.",
                },
            )
        return profile

    def find_session(db, session_id):
        session = db.get(PracticeSession, session_id)
        if session is None:
            raise HTTPException(404, "Practice session not found.")
        require_profile(db, session.profile_id)
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
            "active_count": sum(c.entry_id is not None for c in cards),
            "cards": [
                {
                    "position": c.position,
                    "entry_id": str(c.entry_id) if c.entry_id else None,
                    "snapshot": c.snapshot,
                    "skipped": c.entry_id is None,
                }
                for c in cards
            ],
        }

    @router.post("", status_code=201, dependencies=writes)
    def create(body: SessionCreate):
        with sessions.begin() as db:
            require_profile(db, body.profile_id)
            selection = select(VocabularyEntry).where(
                *category_conditions(
                    body.unit_ids, body.no_unit, body.word_types, body.tag_ids
                ),
            )
            if body.mode == "difficult":
                eligible = difficult_progress(body.profile_id, body.direction)
                selection = selection.where(
                    VocabularyEntry.id.in_(
                        eligible.with_only_columns(LearningProgress.entry_id)
                    )
                )
            available = db.scalar(
                select(func.count()).select_from(selection.subquery())
            )
            if not available:
                raise HTTPException(
                    409,
                    detail={
                        "code": "no_difficult_entries"
                        if body.mode == "difficult"
                        else "no_matches",
                        "message": (
                            "No entries match. Clear filters or add vocabulary "
                            "and try again."
                        ),
                    },
                )
            if body.mode == "mixed":
                entries = mixed_entries(
                    db, selection, body.profile_id, body.direction, body.size
                )
            else:
                entries = db.scalars(
                    selection.order_by(func.random()).limit(body.size)
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
        # All practice mutations lock the learner before the session, matching
        # profile deletion and session creation to avoid inverse-lock deadlocks.
        find_session(db, session_id)
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

    def require_entry(db, card):
        entry = (
            db.scalar(
                select(VocabularyEntry)
                .where(VocabularyEntry.id == card.entry_id)
                .with_for_update(of=VocabularyEntry)
            )
            if card.entry_id
            else None
        )
        if entry is None:
            raise HTTPException(
                409,
                detail={
                    "code": "entry_deleted",
                    "message": "This entry was deleted. Skip this card.",
                },
            )

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
            require_entry(db, card)
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
            require_entry(db, card)
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
