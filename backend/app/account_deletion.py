"""Remove owned application data and reliably delete the provider identity."""

import asyncio
import hashlib
import logging

from fastapi import HTTPException
from sqlalchemy import delete, or_, select, text, update
from starlette.concurrency import run_in_threadpool

from app.legacy_models import SecurityEvent
from app.models import (
    Account,
    AccountDeletion,
    Collection,
    CollectionEntry,
    LearningProgress,
    PracticeSession,
    Profile,
    RecoveryCaseGuard,
    ReviewEvent,
    SessionCard,
    Tag,
    Unit,
    VocabularyEntry,
    entry_tags,
)

log = logging.getLogger("lexi.security")


def subject_hash(subject):
    return hashlib.sha256(subject.encode()).hexdigest()


def lock_subject(db, subject):
    # The same transaction lock protects provisioning and deletion.
    db.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:subject, 0))"),
        {"subject": subject},
    )


def delete_local_account(sessions, account_id, subject):
    with sessions.begin() as db:
        lock_subject(db, subject)
        # Match role updates' ordering to prevent concurrent last-admin deletion.
        accounts = db.scalars(
            select(Account).order_by(Account.id).with_for_update()
        ).all()
        account = next(
            (
                a
                for a in accounts
                if a.id == account_id and a.provider_subject == subject
            ),
            None,
        )
        if account is None:
            raise HTTPException(401, "Authentication required.")
        if account.role == "admin" and sum(a.role == "admin" for a in accounts) == 1:
            raise HTTPException(
                409,
                {
                    "code": "last_admin",
                    "message": "Assign another administrator before "
                    "deleting this account.",
                },
            )
        profile_id = account.profile_id
        # Never remove another account's resolution case as a side effect.
        conflict = db.scalar(
            select(RecoveryCaseGuard.case_id)
            .where(
                RecoveryCaseGuard.account_id != account_id,
                or_(
                    RecoveryCaseGuard.legacy_profile_id == profile_id,
                    RecoveryCaseGuard.current_profile_id == profile_id,
                ),
            )
            .limit(1)
        )
        if conflict:
            raise HTTPException(
                409,
                {
                    "code": "account_deletion_conflict",
                    "message": "A legacy recovery case must be resolved "
                    "before this account can be deleted.",
                },
            )
        # Do not erase another learner's collection or learning history.
        owned_ids = (
            select(VocabularyEntry.id)
            .where(VocabularyEntry.owner_account_id == account_id)
            .execution_options(unscoped=True, include_archived=True)
        )
        shared = (
            db.scalar(
                select(CollectionEntry.entry_id)
                .join(Collection)
                .where(
                    CollectionEntry.entry_id.in_(owned_ids),
                    Collection.owner_account_id.is_distinct_from(account_id),
                )
                .limit(1)
                .execution_options(unscoped=True)
            )
            or db.scalar(
                select(LearningProgress.entry_id)
                .where(
                    LearningProgress.entry_id.in_(owned_ids),
                    LearningProgress.profile_id != profile_id,
                )
                .limit(1)
                .execution_options(unscoped=True)
            )
            or db.scalar(
                select(ReviewEvent.entry_id)
                .where(
                    ReviewEvent.entry_id.in_(owned_ids),
                    ReviewEvent.profile_id != profile_id,
                )
                .limit(1)
                .execution_options(unscoped=True)
            )
            or db.scalar(
                select(SessionCard.entry_id)
                .join(PracticeSession)
                .where(
                    SessionCard.entry_id.in_(owned_ids),
                    PracticeSession.profile_id != profile_id,
                )
                .limit(1)
                .execution_options(unscoped=True)
            )
        )
        # A tag can be shared with cards owned by someone else even when no
        # vocabulary card from this account is in their collection.
        shared = shared or db.scalar(
            select(entry_tags.c.tag_id)
            .join(Tag, Tag.id == entry_tags.c.tag_id)
            .join(VocabularyEntry, VocabularyEntry.id == entry_tags.c.entry_id)
            .where(
                Tag.owner_account_id == account_id,
                VocabularyEntry.owner_account_id.is_distinct_from(account_id),
            )
            .execution_options(unscoped=True, include_archived=True)
            .limit(1)
        )
        if shared:
            raise HTTPException(
                409,
                {
                    "code": "account_deletion_shared_content",
                    "message": "Shared cards have other learners' collections or "
                    "history; contact an administrator before deleting this account.",
                },
            )
        db.add(
            AccountDeletion(
                subject_hash=subject_hash(subject), provider_subject=subject
            )
        )
        db.execute(
            update(SecurityEvent)
            .where(SecurityEvent.actor_account_id == account_id)
            .values(actor_account_id=None)
        )
        session_ids = (
            select(PracticeSession.id)
            .where(PracticeSession.profile_id == profile_id)
            .execution_options(unscoped=True)
        )
        db.execute(delete(ReviewEvent).where(ReviewEvent.profile_id == profile_id))
        db.execute(
            delete(LearningProgress).where(LearningProgress.profile_id == profile_id)
        )
        db.execute(delete(SessionCard).where(SessionCard.session_id.in_(session_ids)))
        db.execute(
            delete(PracticeSession).where(PracticeSession.profile_id == profile_id)
        )
        collection_ids = (
            select(Collection.id)
            .where(Collection.owner_account_id == account_id)
            .execution_options(unscoped=True)
        )
        db.execute(
            delete(CollectionEntry).where(
                CollectionEntry.collection_id.in_(collection_ids)
            )
        )
        db.execute(delete(Collection).where(Collection.owner_account_id == account_id))
        entry_ids = (
            select(VocabularyEntry.id)
            .where(VocabularyEntry.owner_account_id == account_id)
            .execution_options(unscoped=True, include_archived=True)
        )
        db.execute(delete(entry_tags).where(entry_tags.c.entry_id.in_(entry_ids)))
        db.execute(
            delete(VocabularyEntry).where(
                VocabularyEntry.owner_account_id == account_id
            )
        )
        db.execute(delete(Tag).where(Tag.owner_account_id == account_id))
        db.execute(delete(Unit).where(Unit.owner_account_id == account_id))
        db.execute(delete(Account).where(Account.id == account_id))
        db.execute(delete(Profile).where(Profile.id == profile_id))


def pending_subjects(sessions):
    with sessions() as db:
        return list(
            db.scalars(
                select(AccountDeletion.provider_subject).where(
                    AccountDeletion.provider_subject.is_not(None)
                )
            )
        )


def complete_provider_deletion(sessions, subject):
    with sessions.begin() as db:
        row = db.get(AccountDeletion, subject_hash(subject), with_for_update=True)
        if row and row.provider_subject == subject:
            row.provider_subject = None


async def process_pending(sessions):
    from supertokens_python.asyncio import delete_user
    from supertokens_python.recipe.session.asyncio import revoke_all_sessions_for_user

    for subject in await run_in_threadpool(pending_subjects, sessions):
        try:
            await revoke_all_sessions_for_user(subject)
            await delete_user(subject)
            await run_in_threadpool(complete_provider_deletion, sessions, subject)
        except Exception:
            log.warning("account_deletion_provider_retry")


async def deletion_worker(sessions):
    while True:
        try:
            await process_pending(sessions)
        except Exception:
            log.exception("account_deletion_worker_failed")
        try:
            await asyncio.wait_for(asyncio.Event().wait(), timeout=30)
        except TimeoutError:
            pass
