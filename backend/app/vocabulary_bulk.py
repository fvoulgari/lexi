"""Atomic operations on explicitly selected shared vocabulary cards."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import delete, select, update

from app.filters import vocabulary_conditions
from app.models import ReviewEvent, Unit, VocabularyEntry
from app.schemas import VocabularyBulk, WordType


def vocabulary_bulk_router(sessions, gate):
    router = APIRouter(prefix="/api/vocabulary", dependencies=[Depends(gate.require)])

    @router.get("/selection")
    def selection(
        q: str = Query("", max_length=500),
        unit_ids: list[UUID] = Query(default=[]),
        no_unit: bool = False,
        word_types: list[WordType] = Query(default=[]),
        tag_ids: list[UUID] = Query(default=[]),
    ):
        with sessions() as db:
            ids = db.scalars(
                select(VocabularyEntry.id)
                .where(
                    *vocabulary_conditions(q, unit_ids, no_unit, word_types, tag_ids)
                )
                .order_by(VocabularyEntry.id)
            ).all()
            return {"entry_ids": [str(id) for id in ids]}

    @router.post("/bulk", dependencies=[Depends(gate.check_csrf)])
    def bulk(body: VocabularyBulk):
        ids = set(body.entry_ids)
        with sessions.begin() as db:
            # Reviews and single-card deletion lock these same rows. Stable order
            # prevents deadlocks between overlapping bulk operations.
            found = db.scalars(
                select(VocabularyEntry.id)
                .where(VocabularyEntry.id.in_(ids))
                .order_by(VocabularyEntry.id)
                .with_for_update()
            ).all()
            missing = ids - set(found)
            if missing and body.action == "move":
                raise HTTPException(
                    409,
                    {
                        "code": "bulk_missing",
                        "message": "Some selected cards no longer exist. "
                        "Select them again.",
                    },
                )
            if body.action == "move":
                if db.get(Unit, body.unit_id) is None:
                    raise HTTPException(
                        422,
                        {"code": "invalid_unit", "message": "Choose an existing unit."},
                    )
                db.execute(
                    update(VocabularyEntry)
                    .where(VocabularyEntry.id.in_(ids))
                    .values(unit_id=body.unit_id)
                )
            else:
                reviewed = db.scalars(
                    select(ReviewEvent.entry_id)
                    .where(ReviewEvent.entry_id.in_(ids))
                    .distinct()
                ).all()
                blocked = missing | set(reviewed)
                if blocked:
                    raise HTTPException(
                        409,
                        {
                            "code": "bulk_blocked",
                            "message": "No cards were deleted. "
                            "Some selected cards are reviewed or unavailable.",
                            "entry_ids": sorted(str(id) for id in blocked),
                        },
                    )
                db.execute(delete(VocabularyEntry).where(VocabularyEntry.id.in_(ids)))
            return {"count": len(ids), "action": body.action}

    return router
