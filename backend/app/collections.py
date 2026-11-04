"""Personal collections reference cards; membership never grants card access."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import delete, select

from app.access import current_account
from app.models import Collection, CollectionEntry, VocabularyEntry
from app.schemas import VocabularyOutput


class CollectionBody(BaseModel):
    name: str = Field(min_length=1, max_length=160)


class MembershipBody(BaseModel):
    entry_id: UUID


def collection_router(sessions, gate):
    router = APIRouter(prefix="/api/collections", dependencies=[Depends(gate.require)])
    writes = [Depends(gate.check_csrf)]

    def owned(db, collection_id):
        collection = db.scalar(
            select(Collection).where(
                Collection.id == collection_id,
                Collection.owner_account_id == current_account().id,
            )
        )
        if collection is None:
            raise HTTPException(404, "Collection not found.")
        return collection

    @router.get("")
    def listing():
        with sessions() as db:
            return [
                {
                    "id": str(c.id),
                    "name": c.title,
                    "entry_ids": [
                        str(e)
                        for e in db.scalars(
                            select(VocabularyEntry.id)
                            .join(
                                CollectionEntry,
                                CollectionEntry.entry_id == VocabularyEntry.id,
                            )
                            .where(CollectionEntry.collection_id == c.id)
                        )
                    ],
                }
                for c in db.scalars(
                    select(Collection).order_by(Collection.title, Collection.id)
                )
            ]

    @router.post("", status_code=201, dependencies=writes)
    def create(body: CollectionBody):
        with sessions.begin() as db:
            collection = Collection(
                title=body.name.strip(), owner_account_id=current_account().id
            )
            if not collection.title:
                raise HTTPException(422, "Collection title is required.")
            db.add(collection)
            db.flush()
            return {"id": str(collection.id), "name": collection.title, "entry_ids": []}

    @router.patch("/{collection_id}", dependencies=writes)
    def rename(collection_id: UUID, body: CollectionBody):
        with sessions.begin() as db:
            collection = owned(db, collection_id)
            if not body.name.strip():
                raise HTTPException(422, "Collection title is required.")
            collection.title = body.name.strip()
            return {"id": str(collection.id), "name": collection.title, "entry_ids": []}

    @router.delete("/{collection_id}", status_code=204, dependencies=writes)
    def remove(collection_id: UUID):
        with sessions.begin() as db:
            db.delete(owned(db, collection_id))

    @router.get("/{collection_id}/entries")
    def entries(collection_id: UUID):
        with sessions() as db:
            owned(db, collection_id)
            cards = db.scalars(
                select(VocabularyEntry)
                .join(CollectionEntry, CollectionEntry.entry_id == VocabularyEntry.id)
                .where(CollectionEntry.collection_id == collection_id)
                .order_by(VocabularyEntry.italian, VocabularyEntry.id)
            )
            return [
                VocabularyOutput.model_validate(card).model_dump(mode="json")
                for card in cards
            ]

    @router.post("/{collection_id}/entries", status_code=204, dependencies=writes)
    def add_body(collection_id: UUID, body: MembershipBody):
        return add(collection_id, body.entry_id)

    @router.put(
        "/{collection_id}/entries/{entry_id}", status_code=204, dependencies=writes
    )
    def add(collection_id: UUID, entry_id: UUID):
        with sessions.begin() as db:
            owned(db, collection_id)
            if db.get(VocabularyEntry, entry_id) is None:
                raise HTTPException(404, "Vocabulary card not found.")
            if db.get(CollectionEntry, (collection_id, entry_id)) is None:
                db.add(CollectionEntry(collection_id=collection_id, entry_id=entry_id))

    @router.delete(
        "/{collection_id}/entries/{entry_id}", status_code=204, dependencies=writes
    )
    def discard(collection_id: UUID, entry_id: UUID):
        with sessions.begin() as db:
            owned(db, collection_id)
            db.execute(
                delete(CollectionEntry).where(
                    CollectionEntry.collection_id == collection_id,
                    CollectionEntry.entry_id == entry_id,
                )
            )

    return router
