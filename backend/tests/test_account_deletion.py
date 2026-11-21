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


def test_deletion_anonymizes_recovery_records_and_preserves_completed_claim(client, account_client):
    from datetime import datetime, timedelta, timezone
    from app.legacy_models import ClaimLink, LegacyRequest

    account = account_client("delete-with-claim")
    now = datetime.now(timezone.utc)
    sessions = client.app.state.sessions
    with sessions.begin() as db:
        request = LegacyRequest(account_id=UUID(account["id"]), profile_name="Personal name", note="Personal note", status="resolved")
        db.add(request)
        db.add(ClaimLink(token_hash="a" * 64, profile_id=UUID(account["profile_id"]), issued_by=UUID(account["id"]), expires_at=now + timedelta(days=1), consumed_at=now))
        db.flush()
        request_id = request.id
    response = client.delete("/api/account", headers=headers(client))
    assert response.status_code == 200, response.text
    with sessions() as db:
        request = db.get(LegacyRequest, request_id)
        claim = db.get(ClaimLink, "a" * 64)
        assert (request.account_id, request.profile_name, request.note) == (None, "[deleted]", None)
        assert (claim.profile_id, claim.issued_by) == (None, None)
        assert claim.consumed_at is not None


def test_deletion_blocks_other_accounts_recovery_conflict(client, account_client):
    from uuid import uuid4
    from app.models import RecoveryCaseGuard

    other = account_client("case-other")
    target = account_client("case-target")
    with client.app.state.sessions.begin() as db:
        db.add(RecoveryCaseGuard(case_id=uuid4(), account_id=UUID(other["id"]), legacy_profile_id=UUID(target["profile_id"]), current_profile_id=UUID(other["profile_id"])))
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
        db.add(LearningProgress(profile_id=UUID(other["profile_id"]), entry_id=UUID(card["id"]), direction="greek_to_italian", last_reviewed_at=datetime.now(timezone.utc)))
    response = client.delete("/api/account", headers=headers(client))
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "account_deletion_shared_content"
    with client.app.state.sessions() as db:
        assert db.get(Account, UUID(owner["id"])) is not None
        assert db.get(LearningProgress, (UUID(other["profile_id"]), UUID(card["id"]), "greek_to_italian")) is not None
