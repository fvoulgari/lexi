"""Atomic operations on explicitly selected shared vocabulary cards."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select, update

from app.access import current_account, require_same_scope, require_write
from app.filters import vocabulary_conditions
from app.models import Collection, CollectionEntry, Unit, VocabularyEntry
from app.schemas import VocabularyBulk, WordType
from app.vocabulary_deletion import delete_entries


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
            selected = list(
                db.scalars(
                    select(VocabularyEntry)
                    .where(VocabularyEntry.id.in_(ids))
                    .order_by(VocabularyEntry.id)
                    .with_for_update(of=VocabularyEntry)
                ).all()
            )
            for entry in selected:
                require_write(entry)
            found = db.scalars(
                select(VocabularyEntry.id)
                .where(VocabularyEntry.id.in_(ids))
                .order_by(VocabularyEntry.id)
                .with_for_update(of=VocabularyEntry)
            ).all()
            missing = ids - set(found)
            if missing and body.action in {"move", "add_to_collection"}:
                raise HTTPException(
                    409,
                    {
                        "code": "bulk_missing",
                        "message": "Some selected cards no longer exist. "
                        "Select them again.",
                    },
                )
            if body.action == "add_to_collection":
                collection = db.scalar(
                    select(Collection)
                    .where(Collection.id == body.collection_id)
                    .with_for_update()
                )
                if (
                    collection is None
                    or collection.owner_account_id != current_account().id
                ):
                    raise HTTPException(403, "Choose a collection you own.")
                if collection.visibility != "private":
                    raise HTTPException(
                        409, "Add cards to a private collection before publishing it."
                    )
                if any(
                    {entry.source_language, entry.target_language}
                    != {collection.source_language, collection.target_language}
                    for entry in selected
                ):
                    raise HTTPException(
                        422, "Card language pair differs from collection."
                    )
                existing = set(
                    db.scalars(
                        select(CollectionEntry.entry_id).where(
                            CollectionEntry.collection_id == collection.id
                        )
                    )
                )
                position = (
                    db.scalar(
                        select(
                            func.coalesce(func.max(CollectionEntry.position), -1)
                        ).where(CollectionEntry.collection_id == collection.id)
                    )
                    + 1
                )
                for entry in selected:
                    if entry.id not in existing:
                        db.add(
                            CollectionEntry(
                                collection_id=collection.id,
                                entry_id=entry.id,
                                position=position,
                            )
                        )
                        position += 1
            elif body.action == "move":
                if db.get(Unit, body.unit_id) is None:
                    raise HTTPException(
                        422,
                        {"code": "invalid_unit", "message": "Choose an existing unit."},
                    )
                destination = db.get(Unit, body.unit_id)
                for entry in selected:
                    require_same_scope(entry, destination)
                db.execute(
                    update(VocabularyEntry)
                    .where(VocabularyEntry.id.in_(ids))
                    .values(unit_id=body.unit_id)
                )
            else:
                blocked = missing
                if blocked:
                    raise HTTPException(
                        409,
                        {
                            "code": "bulk_blocked",
                            "message": "No cards were deleted. "
                            "Some selected cards are unavailable.",
                            "entry_ids": sorted(str(id) for id in blocked),
                        },
                    )
                delete_entries(db, ids)
            return {"count": len(ids), "action": body.action}

    return router
