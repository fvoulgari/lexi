"""Account boundaries shared by HTTP handlers and ORM reads."""

from contextvars import ContextVar

from fastapi import HTTPException
from sqlalchemy import and_, event, or_, select
from sqlalchemy.orm import Session, with_loader_criteria

from app.models import (
    Account,
    Collection,
    CollectionEntry,
    LearningProgress,
    PracticeSession,
    Profile,
    ReviewEvent,
    Tag,
    Unit,
    VocabularyEntry,
)

account_context: ContextVar[Account | None] = ContextVar("account", default=None)


def current_account():
    account = account_context.get()
    if account is None:
        raise HTTPException(401, "Authentication required.")
    return account


def collection_grant(model=VocabularyEntry, excluding=None):
    # Core tables avoid applying unrelated ORM collection/user scopes inside the
    # grant predicate. Only the card creator's explicitly confirmed publication
    # counts; foreign references cannot extend access.
    refs = CollectionEntry.__table__
    collections = Collection.__table__
    return (
        select(refs.c.entry_id)
        .join(collections, refs.c.collection_id == collections.c.id)
        .where(
            refs.c.entry_id == model.id,
            refs.c.publication_confirmed.is_(True),
            collections.c.visibility == "published",
            collections.c.owner_account_id == model.owner_account_id,
            collections.c.id != excluding if excluding is not None else True,
        )
        .correlate(model)
        .exists()
    )


def visible(model, account=None):
    account = account or current_account()
    shared = [model.visibility == "published"]
    if model is VocabularyEntry:
        shared.append(and_(model.visibility == "private", collection_grant(model)))
    return or_(
        model.owner_account_id == account.id,
        *shared,
        and_(
            model.owner_account_id.is_(None),
            model.visibility == "legacy",
            account.legacy_access or account.role == "admin",
        ),
    )


def can_write(entity, account=None):
    account = account or current_account()
    return entity.owner_account_id == account.id or (
        entity.owner_account_id is None
        and account.role in {"editor", "admin"}
        and (
            entity.visibility == "published"
            or account.legacy_access
            or account.role == "admin"
        )
    )


def require_write(entity, account=None):
    if entity is None:
        raise HTTPException(404, "Content not found.")
    if not can_write(entity, account):
        raise HTTPException(403, "You cannot change this content.")
    return entity


def apply_scope(entity, account=None, visibility="private"):
    account = account or current_account()
    if visibility not in {"private", "legacy", "published"}:
        raise HTTPException(422, "Invalid visibility.")
    if visibility != "private" and account.role not in {"editor", "admin"}:
        raise HTTPException(403, "Shared-library editing permission required.")
    if (
        visibility == "legacy"
        and account.role == "editor"
        and not account.legacy_access
    ):
        raise HTTPException(403, "Legacy-library access required.")
    if visibility == "published" and account.role != "admin":
        raise HTTPException(403, "Only administrators may publish content.")
    entity.owner_account_id = account.id if visibility == "private" else None
    entity.visibility = visibility
    return entity


def require_same_scope(entity, related):
    require_write(entity)
    if (
        related is None
        or entity.owner_account_id != related.owner_account_id
        or (entity.visibility == "published" and related.visibility != "published")
        or (entity.owner_account_id is not None and related.visibility != "private")
    ):
        raise HTTPException(422, "Choose content from the same library.")
    return related


def require_profile(profile_id):
    if profile_id != current_account().profile_id:
        raise HTTPException(
            404, {"code": "profile_not_found", "message": "Learner profile not found."}
        )


def require_admin():
    account = current_account()
    if account.role != "admin":
        raise HTTPException(403, "Administrator permission required.")
    return account


@event.listens_for(Session, "do_orm_execute")
def scope_reads(state):
    account = account_context.get()
    if (
        account is None
        or not state.is_select
        or state.execution_options.get("unscoped")
    ):
        return
    statement = state.statement
    for model in (Unit, Tag, VocabularyEntry):
        statement = statement.options(
            with_loader_criteria(model, visible(model, account), include_aliases=True)
        )
    for model in (Profile,):
        statement = statement.options(
            with_loader_criteria(
                model, model.id == account.profile_id, include_aliases=True
            )
        )
    for model in (PracticeSession, ReviewEvent, LearningProgress):
        statement = statement.options(
            with_loader_criteria(
                model, model.profile_id == account.profile_id, include_aliases=True
            )
        )
    statement = statement.options(
        with_loader_criteria(
            Collection,
            or_(
                Collection.owner_account_id == account.id,
                Collection.visibility == "published",
            ),
            include_aliases=True,
        )
    )
    if not state.execution_options.get("include_archived"):
        statement = statement.options(
            with_loader_criteria(
                VocabularyEntry,
                VocabularyEntry.archived_at.is_(None),
                include_aliases=True,
            )
        )
    state.statement = statement


def lock_owned_profile(db, profile_id):
    """Serialize personal writes against claims using Account then Profile locks."""
    account = db.scalar(
        select(Account).where(Account.id == current_account().id).with_for_update()
    )
    if account is None or account.profile_id != profile_id:
        raise HTTPException(
            404, {"code": "profile_not_found", "message": "Learner profile not found."}
        )
    profile = db.scalar(
        select(Profile).where(Profile.id == profile_id).with_for_update()
    )
    if profile is None:
        raise HTTPException(
            404, {"code": "profile_not_found", "message": "Learner profile not found."}
        )
    return profile
