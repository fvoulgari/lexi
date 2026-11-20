"""Ordered references with independent card ownership and explicit publication."""

import hashlib
import json
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sqlalchemy import delete, func, select, update

from app.access import collection_grant, current_account, require_write
from app.languages import pair
from app.models import (
    Collection,
    CollectionEntry,
    LearningProgress,
    Unit,
    VocabularyEntry,
)
from app.schemas import Direction, EntryText


class CollectionBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=160)
    source_language: str = "el"
    target_language: str = "it"

    @model_validator(mode="after")
    def valid_pair(self):
        self.source_language, self.target_language = pair(
            self.source_language, self.target_language
        )
        if not self.name.strip():
            raise ValueError("Collection title is required.")
        return self


class MembershipBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    entry_id: UUID
    confirm_private_ids: list[UUID] = []
    exposure_token: str = Field(default="", max_length=64)


class PublishBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    confirm_private_ids: list[UUID] = []
    preview_token: str = Field(default="", max_length=64)


class OrderBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    entry_ids: list[UUID] = Field(max_length=5000)


class CardBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    source_text: EntryText
    target_text: EntryText

    @field_validator("source_text", "target_text")
    @classmethod
    def valid_text(cls, value):
        if any(ord(c) == 0 or 0xD800 <= ord(c) <= 0xDFFF for c in value):
            raise ValueError("Text contains invalid Unicode.")
        return value

    source_language: str | None = None
    target_language: str | None = None
    confirm_exposure: bool = False

    @model_validator(mode="after")
    def valid_languages(self):
        if self.source_language is not None or self.target_language is not None:
            pair(self.source_language, self.target_language)
        return self


class CardUpdate(CardBody):
    withdraw: bool = False


def collection_router(sessions, gate):
    router = APIRouter(prefix="/api/collections", dependencies=[Depends(gate.require)])
    writes = [Depends(gate.check_csrf)]

    def find(db, collection_id, write=False):
        collection = db.scalar(
            select(Collection).where(Collection.id == collection_id).with_for_update()
            if write
            else select(Collection).where(Collection.id == collection_id)
        )
        if collection is None:
            raise HTTPException(404, "Collection not found.")
        if write and collection.owner_account_id != current_account().id:
            raise HTTPException(403, "Only the collection creator can change it.")
        return collection

    def cards(db, collection):
        return list(
            db.scalars(
                select(VocabularyEntry)
                .join(CollectionEntry, CollectionEntry.entry_id == VocabularyEntry.id)
                .where(CollectionEntry.collection_id == collection.id)
                .order_by(CollectionEntry.position)
            )
        )

    def card_token(card):
        return hashlib.sha256(
            json.dumps(
                [str(card.id), card.source_text, card.target_text, str(card.updated_at)]
            ).encode()
        ).hexdigest()

    def shared_elsewhere(db, card, excluding=None):
        return bool(
            db.scalar(
                select(collection_grant(excluding=excluding))
                .select_from(VocabularyEntry)
                .where(VocabularyEntry.id == card.id)
            )
        )

    def card_output(db, card):
        return {
            "id": str(card.id),
            "source_language": card.source_language,
            "target_language": card.target_language,
            "source_text": card.source_text,
            "target_text": card.target_text,
            "visibility": card.visibility,
            "shared_via_collection": shared_elsewhere(db, card),
            "requires_confirmation": card.owner_account_id == current_account().id
            and card.visibility == "private",
            "can_edit": card.owner_account_id == current_account().id,
            "exposure_token": card_token(card),
        }

    def output(db, collection):
        accessible = cards(db, collection)
        references = list(
            db.scalars(
                select(CollectionEntry.entry_id).where(
                    CollectionEntry.collection_id == collection.id
                )
            )
        )
        readable = {e.id for e in accessible}
        return {
            "id": str(collection.id),
            "name": collection.title,
            "source_language": collection.source_language,
            "target_language": collection.target_language,
            "visibility": collection.visibility,
            "can_edit": collection.owner_account_id == current_account().id,
            "entry_ids": [str(c.id) for c in accessible],
            "card_count": len(accessible),
            "unavailable_entry_ids": [str(e) for e in references if e not in readable]
            if collection.owner_account_id == current_account().id
            else [],
        }

    def preview_token(db, collection, private):
        payload = {
            "collection": output(db, collection),
            "private": [
                [str(e.id), e.source_text, e.target_text, str(e.updated_at)]
                for e in sorted(private, key=lambda e: str(e.id))
            ],
        }
        return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()

    def exposures(db, collection):
        # Inspect every reference, including inaccessible/archived ones, without
        # returning hidden text. Publication fails closed rather than leaking it.
        ids = list(
            db.scalars(
                select(CollectionEntry.entry_id).where(
                    CollectionEntry.collection_id == collection.id
                )
            )
        )
        entries = list(
            db.scalars(
                select(VocabularyEntry)
                .where(VocabularyEntry.id.in_(ids))
                .with_for_update(of=VocabularyEntry)
            )
        )
        if len(entries) != len(ids):
            raise HTTPException(409, "Remove unavailable cards before publishing.")
        for entry in entries:
            if entry.visibility not in {"private", "published"}:
                raise HTTPException(
                    409, "Restricted cards cannot be published in a collection."
                )
        return [
            e
            for e in entries
            if e.visibility == "private"
            and e.owner_account_id == collection.owner_account_id
        ]

    def confirm_publication(db, collection, entries, confirmed):
        if {e.id for e in entries} != set(confirmed):
            raise HTTPException(
                409, "Review and confirm the current private cards before publishing."
            )
        for entry in entries:
            reference = db.get(CollectionEntry, (collection.id, entry.id))
            reference.publication_confirmed = True

    @router.get("")
    def listing(
        source_language: str | None = None,
        target_language: str | None = None,
        published: bool = False,
    ):
        with sessions() as db:
            query = select(Collection).order_by(Collection.title, Collection.id)
            if source_language is not None or target_language is not None:
                try:
                    a, b = pair(source_language, target_language)
                except ValueError as error:
                    raise HTTPException(422, str(error)) from None
                query = query.where(
                    Collection.source_language == a, Collection.target_language == b
                )
            if published:
                query = query.where(Collection.visibility == "published")
            return [output(db, c) for c in db.scalars(query)]

    @router.post("", status_code=201, dependencies=writes)
    def create(body: CollectionBody):
        with sessions.begin() as db:
            collection = Collection(
                title=body.name.strip(),
                owner_account_id=current_account().id,
                source_language=body.source_language,
                target_language=body.target_language,
                visibility="private",
            )
            db.add(collection)
            db.flush()
            return output(db, collection)

    @router.patch("/{collection_id}", dependencies=writes)
    def rename(collection_id: UUID, body: CollectionBody):
        with sessions.begin() as db:
            collection = find(db, collection_id, True)
            if (collection.source_language, collection.target_language) != (
                body.source_language,
                body.target_language,
            ):
                raise HTTPException(
                    422, "A collection's language pair cannot be changed."
                )
            collection.title = body.name.strip()
            return output(db, collection)

    @router.delete("/{collection_id}", status_code=204, dependencies=writes)
    def remove(collection_id: UUID):
        with sessions.begin() as db:
            db.delete(find(db, collection_id, True))

    @router.get("/{collection_id}/entries")
    def entries(collection_id: UUID):
        with sessions() as db:
            return [card_output(db, c) for c in cards(db, find(db, collection_id))]

    @router.get("/{collection_id}/search")
    def search(collection_id: UUID, q: str = ""):
        with sessions() as db:
            c = find(db, collection_id)
            from app.filters import vocabulary_conditions

            query = select(VocabularyEntry).where(
                (
                    (VocabularyEntry.source_language == c.source_language)
                    & (VocabularyEntry.target_language == c.target_language)
                )
                | (
                    (VocabularyEntry.source_language == c.target_language)
                    & (VocabularyEntry.target_language == c.source_language)
                ),
                *vocabulary_conditions(q, [], False, [], []),
            )
            return [
                card_output(db, e)
                for e in db.scalars(
                    query.order_by(VocabularyEntry.italian, VocabularyEntry.id).limit(
                        50
                    )
                )
            ]

    @router.get("/{collection_id}/publish-preview")
    def preview(collection_id: UUID):
        with sessions.begin() as db:
            c = find(db, collection_id, True)
            private = exposures(db, c)
            return {
                **output(db, c),
                "private_cards": [card_output(db, e) for e in private],
                "preview_token": preview_token(db, c, private),
            }

    @router.post("/{collection_id}/publish", dependencies=writes)
    def publish(collection_id: UUID, body: PublishBody):
        with sessions.begin() as db:
            c = find(db, collection_id, True)
            private = exposures(db, c)
            if body.preview_token != preview_token(db, c, private):
                raise HTTPException(
                    409, "Collection changed; review publication again."
                )
            confirm_publication(db, c, private, body.confirm_private_ids)
            c.visibility = "published"
            db.flush()
            return output(db, c)

    @router.get("/{collection_id}/unpublish-preview")
    def unpublish_preview(collection_id: UUID):
        with sessions() as db:
            c = find(db, collection_id, True)
            confirmed = set(
                db.scalars(
                    select(CollectionEntry.entry_id).where(
                        CollectionEntry.collection_id == c.id,
                        CollectionEntry.publication_confirmed.is_(True),
                    )
                )
            )
            private = [
                entry
                for entry in cards(db, c)
                if entry.id in confirmed
                and entry.owner_account_id == c.owner_account_id
                and entry.visibility == "private"
            ]
            hidden, remaining = [], []
            for entry in private:
                (
                    remaining if shared_elsewhere(db, entry, excluding=c.id) else hidden
                ).append(card_output(db, entry))
            return {
                **output(db, c),
                "private_cards": hidden,
                "still_shared_cards": remaining,
            }

    @router.post("/{collection_id}/unpublish", dependencies=writes)
    def unpublish(collection_id: UUID):
        with sessions.begin() as db:
            c = find(db, collection_id, True)
            c.visibility = "private"
            db.execute(
                update(CollectionEntry)
                .where(CollectionEntry.collection_id == c.id)
                .values(publication_confirmed=False)
            )
            db.flush()
            return output(db, c)

    def add_card(db, c, entry_id, confirmed, expected_token=""):
        entry = db.scalar(
            select(VocabularyEntry)
            .where(VocabularyEntry.id == entry_id)
            .with_for_update(of=VocabularyEntry)
        )
        if entry is None:
            raise HTTPException(404, "Vocabulary card not found.")
        if pair(entry.source_language, entry.target_language) != (
            c.source_language,
            c.target_language,
        ):
            raise HTTPException(422, "Card language pair differs from collection.")
        own_private = (
            entry.visibility == "private"
            and entry.owner_account_id == c.owner_account_id
        )
        if c.visibility == "published":
            if entry.visibility not in {"private", "published"}:
                raise HTTPException(409, "Restricted cards cannot be published.")
            if own_private and expected_token != card_token(entry):
                raise HTTPException(409, "Card changed; review publication again.")
            if set(confirmed) != ({entry.id} if own_private else set()):
                raise HTTPException(
                    409, "Confirm this collection's private card exposure."
                )
        reference = db.get(CollectionEntry, (c.id, entry_id))
        if reference is None:
            position = (
                db.scalar(
                    select(func.coalesce(func.max(CollectionEntry.position), -1)).where(
                        CollectionEntry.collection_id == c.id
                    )
                )
                + 1
            )
            reference = CollectionEntry(
                collection_id=c.id, entry_id=entry_id, position=position
            )
            db.add(reference)
        if c.visibility == "published" and own_private:
            reference.publication_confirmed = True

    @router.post("/{collection_id}/entries", status_code=204, dependencies=writes)
    def add_body(collection_id: UUID, body: MembershipBody):
        with sessions.begin() as db:
            add_card(
                db,
                find(db, collection_id, True),
                body.entry_id,
                body.confirm_private_ids,
                body.exposure_token,
            )

    @router.put(
        "/{collection_id}/entries/{entry_id}", status_code=204, dependencies=writes
    )
    def add(collection_id: UUID, entry_id: UUID):
        return add_body(collection_id, MembershipBody(entry_id=entry_id))

    @router.delete(
        "/{collection_id}/entries/{entry_id}", status_code=204, dependencies=writes
    )
    def discard(collection_id: UUID, entry_id: UUID):
        with sessions.begin() as db:
            find(db, collection_id, True)
            db.execute(
                delete(CollectionEntry).where(
                    CollectionEntry.collection_id == collection_id,
                    CollectionEntry.entry_id == entry_id,
                )
            )

    @router.put("/{collection_id}/order", dependencies=writes)
    def reorder(collection_id: UUID, body: OrderBody):
        with sessions.begin() as db:
            c = find(db, collection_id, True)
            refs = list(
                db.scalars(
                    select(CollectionEntry).where(CollectionEntry.collection_id == c.id)
                )
            )
            # Keep hidden references when reordering.
            if len(body.entry_ids) != len(set(body.entry_ids)) or set(
                body.entry_ids
            ) != {r.entry_id for r in refs}:
                raise HTTPException(
                    409,
                    "Include every reference exactly once; "
                    "remove unavailable cards first.",
                )
            positions = {key: i for i, key in enumerate(body.entry_ids)}
            for ref in refs:
                ref.position = positions[ref.entry_id]
            return {"ordered": True}

    @router.post("/{collection_id}/cards", status_code=201, dependencies=writes)
    def create_card(collection_id: UUID, body: CardBody):
        with sessions.begin() as db:
            c = find(db, collection_id, True)
            if c.visibility == "published" and not body.confirm_exposure:
                raise HTTPException(
                    409,
                    "Confirm exposure of this new card in the published collection.",
                )
            unit = db.scalar(
                select(Unit)
                .where(Unit.owner_account_id == current_account().id)
                .order_by(Unit.id)
                .limit(1)
            )
            if unit is None:
                unit = Unit(
                    code="CARDS",
                    title="Cards",
                    sort_order=0,
                    owner_account_id=current_account().id,
                    visibility="private",
                )
                db.add(unit)
                db.flush()
            source, target = (
                body.source_language or c.source_language,
                body.target_language or c.target_language,
            )
            if pair(source, target) != (c.source_language, c.target_language):
                raise HTTPException(422, "Card language pair differs from collection.")
            source_text, target_text = body.source_text, body.target_text
            if (source, target) == ("el", "it"):
                source, target, source_text, target_text = (
                    "it",
                    "el",
                    target_text,
                    source_text,
                )
            entry = VocabularyEntry(
                source_language=source,
                target_language=target,
                source_text=source_text,
                target_text=target_text,
                word_type="expression",
                unit_id=unit.id,
                owner_account_id=current_account().id,
                visibility="private",
            )
            db.add(entry)
            db.flush()
            add_card(
                db,
                c,
                entry.id,
                [entry.id] if c.visibility == "published" else [],
                card_token(entry),
            )
            return card_output(db, entry)

    @router.patch("/cards/{entry_id}", dependencies=writes)
    def update_card(entry_id: UUID, body: CardUpdate):
        with sessions.begin() as db:
            entry = db.scalar(
                select(VocabularyEntry)
                .where(VocabularyEntry.id == entry_id)
                .with_for_update(of=VocabularyEntry)
            )
            require_write(entry)
            # Shared legacy editorial permission remains governed by existing API.
            if entry.owner_account_id != current_account().id:
                raise HTTPException(403, "Only the card creator can change it here.")
            if body.source_language is not None and (
                body.source_language,
                body.target_language,
            ) != (entry.source_language, entry.target_language):
                raise HTTPException(422, "Card language order cannot be changed.")
            entry.source_text, entry.target_text = body.source_text, body.target_text
            if body.withdraw:
                db.execute(
                    update(CollectionEntry)
                    .where(CollectionEntry.entry_id == entry.id)
                    .values(publication_confirmed=False)
                )
            db.flush()
            return card_output(db, entry)

    @router.get("/{collection_id}/progress")
    def collection_progress(collection_id: UUID, direction: Direction):
        from app.languages import DIRECTION_PAIRS

        with sessions() as db:
            c = find(db, collection_id)
            if set(DIRECTION_PAIRS[direction]) != {
                c.source_language,
                c.target_language,
            }:
                raise HTTPException(422, "Direction does not match collection.")
            ids = [e.id for e in cards(db, c)]
            records = list(
                db.scalars(
                    select(LearningProgress).where(
                        LearningProgress.entry_id.in_(ids),
                        LearningProgress.direction == direction,
                    )
                )
            )
            return {
                "card_count": len(ids),
                "practised": len(records),
                "reviews": sum(p.reviews for p in records),
                "difficult": sum(
                    p.reviews > 0 and p.weight > 0 and p.weighted_sum >= 0.5 * p.weight
                    for p in records
                ),
            }

    return router
