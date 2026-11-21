"""Test account isolation and retries during deletion."""

import asyncio
from unittest.mock import AsyncMock
from uuid import UUID

from conftest import signin
from sqlalchemy import select
from test_account_http import create_card, create_unit
from test_practice import headers, start
from test_progress import submit

from app.account_deletion import process_pending, subject_hash
from app.models import (
    Account,
    AccountDeletion,
    LearningProgress,
    PracticeSession,
    Profile,
    VocabularyEntry,
)


def test_delete_removes_owned_data_and_retries_provider(
    client, account_client, monkeypatch
):
    import supertokens_python.asyncio as provider
    import supertokens_python.recipe.session.asyncio as session_provider

    remove = AsyncMock(side_effect=RuntimeError("offline"))
    revoke = AsyncMock()
    monkeypatch.setattr(provider, "delete_user", remove)
    monkeypatch.setattr(session_provider, "revoke_all_sessions_for_user", revoke)
    other = account_client("other-learner")
    other_unit = create_unit(client, "OTHER")
    owner = account_client("delete-learner")
    unit = create_unit(client, "MINE")
    card = create_card(client, unit)["entry"]
    practice = start(client).json()
    submit(client, practice, card["id"], "greek_to_italian", "hard")
    assert client.delete("/api/account").status_code == 403
    response = client.delete("/api/account", headers=headers(client))
    assert response.status_code == 200, response.text
    assert client.get("/api/auth/session").status_code == 401
    sessions = client.app.state.sessions
    with sessions() as db:
        assert db.get(Account, UUID(owner["id"])) is None
        assert db.get(Profile, UUID(owner["profile_id"])) is None
        assert db.get(VocabularyEntry, UUID(card["id"])) is None
        assert not db.scalars(
            select(LearningProgress).where(
                LearningProgress.profile_id == UUID(owner["profile_id"])
            )
        ).all()
        assert not db.scalars(
            select(PracticeSession).where(
                PracticeSession.profile_id == UUID(owner["profile_id"])
            )
        ).all()
        assert (
            db.get(AccountDeletion, subject_hash("delete-learner")).provider_subject
            == "delete-learner"
        )
    signin(client, "other-learner")
    assert client.get("/api/auth/session").json()["account"]["id"] == other["id"]
    assert client.get("/api/units").json()[0]["id"] == other_unit["id"]
    remove.side_effect = None
    asyncio.run(process_pending(sessions))
    with sessions() as db:
        assert (
            db.get(AccountDeletion, subject_hash("delete-learner")).provider_subject
            is None
        )
    signin(client, "delete-learner")
    assert client.get("/api/auth/session").status_code == 401


def test_last_admin_cannot_delete(logged_in, monkeypatch):
    response = logged_in.delete("/api/account", headers=headers(logged_in))
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "last_admin"
    assert logged_in.get("/api/auth/session").json()["authenticated"]


def test_deletion_blocks_other_accounts_recovery_conflict(client, account_client):
    from uuid import uuid4

    from app.models import RecoveryCaseGuard

    other = account_client("case-other")
    target = account_client("case-target")
    with client.app.state.sessions.begin() as db:
        db.add(
            RecoveryCaseGuard(
                case_id=uuid4(),
                account_id=UUID(other["id"]),
                legacy_profile_id=UUID(target["profile_id"]),
                current_profile_id=UUID(other["profile_id"]),
            )
        )
    response = client.delete("/api/account", headers=headers(client))
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "account_deletion_conflict"
    assert client.get("/api/auth/session").json()["account"]["id"] == target["id"]


def test_deletion_blocks_when_another_learner_has_progress(client, account_client):
    from datetime import datetime, timezone

    from app.models import LearningProgress

    other = account_client("progress-other")
    owner = account_client("progress-owner")
    unit = create_unit(client, "SHARED")
    card = create_card(client, unit)["entry"]
    with client.app.state.sessions.begin() as db:
        db.add(
            LearningProgress(
                profile_id=UUID(other["profile_id"]),
                entry_id=UUID(card["id"]),
                direction="greek_to_italian",
                last_reviewed_at=datetime.now(timezone.utc),
            )
        )
    response = client.delete("/api/account", headers=headers(client))
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "account_deletion_shared_content"
    with client.app.state.sessions() as db:
        assert db.get(Account, UUID(owner["id"])) is not None
        assert (
            db.get(
                LearningProgress,
                (UUID(other["profile_id"]), UUID(card["id"]), "greek_to_italian"),
            )
            is not None
        )


def test_deletion_preserves_another_accounts_collection_and_snapshot(
    client, account_client
):
    from app.models import Collection, CollectionEntry, PracticeSession, SessionCard

    other = account_client("collection-other")
    other_collection = client.post(
        "/api/collections", headers=headers(client), json={"name": "Other"}
    ).json()
    owner = account_client("collection-owner")
    unit = create_unit(client, "COLLECTION-SHARE")
    card = create_card(client, unit)["entry"]
    with client.app.state.sessions.begin() as db:
        db.add(
            CollectionEntry(
                collection_id=UUID(other_collection["id"]),
                entry_id=UUID(card["id"]),
                position=0,
            )
        )
        practice = PracticeSession(
            profile_id=UUID(other["profile_id"]),
            direction="greek_to_italian",
            available=1,
        )
        db.add(practice)
        db.flush()
        session_id = practice.id
        db.add(
            SessionCard(
                session_id=session_id,
                position=0,
                entry_id=UUID(card["id"]),
                snapshot={"italian": "kept"},
            )
        )
    response = client.delete("/api/account", headers=headers(client))
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "account_deletion_shared_content"
    with client.app.state.sessions() as db:
        assert db.get(Account, UUID(owner["id"])) is not None
        assert db.get(Collection, UUID(other_collection["id"])) is not None
        assert (
            db.get(CollectionEntry, (UUID(other_collection["id"]), UUID(card["id"])))
            is not None
        )
        assert db.get(SessionCard, (session_id, 0)).snapshot == {"italian": "kept"}


def test_concurrent_snapshot_commit_blocks_deletion_and_preserves_data(
    client, account_client
):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event

    from fastapi import HTTPException
    from sqlalchemy import event

    from app.account_deletion import delete_local_account
    from app.models import PracticeSession, SessionCard

    other = account_client("race-snapshot-other")
    owner = account_client("race-snapshot-owner")
    card = create_card(client, create_unit(client, "RACE"))["entry"]
    sessions = client.app.state.sessions
    with sessions.begin() as db:
        practice = PracticeSession(
            profile_id=UUID(other["profile_id"]),
            direction="greek_to_italian",
            available=1,
        )
        db.add(practice)
        db.flush()
        session_id = practice.id
    inserted, release, lock_started = Event(), Event(), Event()

    def observe_lock(conn, cursor, statement, parameters, context, executemany):
        if "FROM vocabulary_entries" in statement and "FOR UPDATE" in statement:
            lock_started.set()

    engine = sessions.kw["bind"]
    event.listen(engine, "before_cursor_execute", observe_lock)

    def add_snapshot():
        with sessions.begin() as db:
            db.add(
                SessionCard(
                    session_id=session_id,
                    position=0,
                    entry_id=UUID(card["id"]),
                    snapshot={"italian": "preserved"},
                )
            )
            db.flush()
            inserted.set()
            assert release.wait(10)

    def delete_owner():
        try:
            delete_local_account(sessions, UUID(owner["id"]), "race-snapshot-owner")
        except HTTPException as exc:
            return exc.status_code, exc.detail["code"]
        return None

    with ThreadPoolExecutor(max_workers=2) as pool:
        writer = pool.submit(add_snapshot)
        assert inserted.wait(10)
        deletion = pool.submit(delete_owner)
        try:
            assert lock_started.wait(10)
            assert not deletion.done()
        finally:
            release.set()
        writer.result(timeout=10)
        assert deletion.result(timeout=10) == (409, "account_deletion_shared_content")
    event.remove(engine, "before_cursor_execute", observe_lock)
    with sessions() as db:
        assert db.get(Account, UUID(owner["id"])) is not None
        snapshot = db.get(SessionCard, (session_id, 0))
        assert snapshot.entry_id == UUID(card["id"])
        assert snapshot.snapshot == {"italian": "preserved"}


def test_concurrent_deletions_preserve_cross_account_case_guards(
    client, account_client
):
    from concurrent.futures import ThreadPoolExecutor
    from uuid import uuid4

    from fastapi import HTTPException

    from app.account_deletion import delete_local_account
    from app.models import RecoveryCaseGuard

    first = account_client("race-case-first")
    second = account_client("race-case-second")
    with client.app.state.sessions.begin() as db:
        db.add_all(
            [
                RecoveryCaseGuard(
                    case_id=uuid4(),
                    account_id=UUID(first["id"]),
                    legacy_profile_id=UUID(second["profile_id"]),
                    current_profile_id=UUID(first["profile_id"]),
                ),
                RecoveryCaseGuard(
                    case_id=uuid4(),
                    account_id=UUID(second["id"]),
                    legacy_profile_id=UUID(first["profile_id"]),
                    current_profile_id=UUID(second["profile_id"]),
                ),
            ]
        )

    def attempt(account, subject):
        try:
            delete_local_account(
                client.app.state.sessions, UUID(account["id"]), subject
            )
        except HTTPException as exc:
            return exc.status_code, exc.detail["code"]
        return None

    with ThreadPoolExecutor(max_workers=2) as pool:
        a = pool.submit(attempt, first, "race-case-first")
        b = pool.submit(attempt, second, "race-case-second")
        assert a.result(timeout=10) == (409, "account_deletion_conflict")
        assert b.result(timeout=10) == (409, "account_deletion_conflict")
    with client.app.state.sessions() as db:
        assert db.get(Account, UUID(first["id"])) is not None
        assert db.get(Account, UUID(second["id"])) is not None
