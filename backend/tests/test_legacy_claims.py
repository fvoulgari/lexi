"""Claims exercise HTTP, PostgreSQL locks and persisted ownership together."""

from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from threading import Barrier
from uuid import UUID

import pytest
from conftest import signin
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.legacy_claims import COOKIE, digest
from app.legacy_models import (
    ClaimContinuation,
    ClaimLink,
    LegacyRequest,
    ResolutionCase,
    SecurityEvent,
)
from app.models import Account, Collection, Profile

HEADERS = {"X-CSRF-Token": "supertokens", "Origin": "http://testserver"}


def issue(client):
    signin(client)
    profiles = client.get("/api/admin/legacy-profiles").json()
    profile = profiles[0]
    result = client.post(
        f"/api/admin/legacy-profiles/{profile['id']}/claim-links",
        json={"acknowledge": True},
        headers=HEADERS,
    )
    assert result.status_code == 200, result.text
    token = result.json()["claim_url"].split("#token=")[1]
    return profile, token


def capture(client, token):
    response = client.post(
        "/api/legacy-claims/capture", json={"token": token}, headers=HEADERS
    )
    assert response.status_code == 200, response.text
    return response


def test_claim_preserves_legacy_identity_and_does_not_grant_privileges(
    client, account_client
):
    legacy, token = issue(client)
    before = account_client("new-claimant")
    capture(client, token)
    preview = client.get("/api/legacy-claims/preview")
    assert preview.status_code == 200
    assert preview.json()["profile"]["id"] == legacy["id"]
    assert client.get("/api/legacy-claims/redeem").status_code in {404, 405}
    assert client.post("/api/legacy-claims/redeem").status_code == 403
    assert client.get("/api/account").json()["profile_id"] == before["profile_id"]
    result = client.post("/api/legacy-claims/redeem", json={}, headers=HEADERS)
    assert result.status_code == 200, result.text
    after = client.get("/api/account").json()
    assert after["profile_id"] == legacy["id"]
    assert after["role"] == "learner"
    assert after["legacy_access"] is False
    assert client.get("/api/vocabulary").json()["total"] == 0
    with client.app.state.sessions() as db:
        link = db.get(ClaimLink, digest(token))
        assert link.consumed_at is not None
        assert db.get(Profile, UUID(before["profile_id"])) is not None
        assert (
            count(db, SecurityEvent, SecurityEvent.event == "legacy_claim_redeemed")
            == 1
        )
    capture(client, token)
    assert (
        client.get("/api/legacy-claims/preview").json()["error"]["code"] == "claim_used"
    )


def count(db, model, *conditions):
    return db.scalar(select(func.count()).select_from(model).where(*conditions))


def test_capture_hides_profile_before_auth_and_stores_hashes_only(client):
    legacy, token = issue(client)
    client.cookies.clear()
    response = capture(client, token)
    assert "httponly" in response.headers["set-cookie"].lower()
    assert response.headers["referrer-policy"] == "no-referrer"
    assert token not in response.text
    assert legacy["display_name"] not in response.text
    assert client.get("/api/legacy-claims/preview").status_code == 401
    with client.app.state.sessions() as db:
        assert db.get(ClaimLink, digest(token)) is not None
        pending = db.scalars(select(ClaimContinuation)).one()
        assert pending.token_hash == digest(token)
        assert pending.secret_hash != client.cookies.get(COOKIE)
    assert (
        client.post(
            "/api/legacy-claims/capture",
            json={"token": token},
            headers={"Origin": "https://evil.example"},
        ).status_code
        == 403
    )


@pytest.mark.parametrize("state", ["expired", "revoked", "invalid", "regenerated"])
def test_invalid_claim_states_do_not_change_ownership(client, account_client, state):
    legacy, token = issue(client)
    if state == "regenerated":
        client.post(
            f"/api/admin/legacy-profiles/{legacy['id']}/claim-links",
            json={"acknowledge": True},
            headers=HEADERS,
        )
    elif state in {"expired", "revoked"}:
        with client.app.state.sessions.begin() as db:
            row = db.get(ClaimLink, digest(token))
            if state == "expired":
                row.expires_at = datetime.now(UTC) - timedelta(seconds=1)
            else:
                row.revoked_at = datetime.now(UTC)
    else:
        token = "invalid-token-not-in-database-12345"
    before = account_client("claimant")
    capture(client, token)
    response = client.post("/api/legacy-claims/redeem", headers=HEADERS)
    assert response.status_code == 400
    assert (
        response.json()["error"]["code"]
        == {
            "expired": "claim_expired",
            "revoked": "claim_revoked",
            "invalid": "claim_invalid",
            "regenerated": "claim_revoked",
        }[state]
    )
    assert client.get("/api/account").json()["profile_id"] == before["profile_id"]


def test_owned_collection_blocks_claim_and_preserves_token_and_both_profiles(
    client, account_client
):
    legacy, token = issue(client)
    account = account_client("active-claimant")
    result = client.post(
        "/api/collections", json={"name": "Keep my cards"}, headers=HEADERS
    )
    assert result.status_code == 201
    capture(client, token)
    for _ in range(2):
        response = client.post("/api/legacy-claims/redeem", headers=HEADERS)
        assert response.status_code == 409
        assert response.json()["error"]["code"] == "claim_conflict"
        assert response.json()["error"]["report"]["current"]["collections"] == 1
    assert client.get("/api/account").json()["profile_id"] == account["profile_id"]
    with client.app.state.sessions() as db:
        assert db.get(ClaimLink, digest(token)).consumed_at is None
        assert count(db, ResolutionCase) == 1
        assert count(db, Collection) == 1
        assert db.get(Profile, UUID(legacy["id"])) is not None


def test_cancel_and_non_admin_operations_never_claim(client, account_client):
    legacy, token = issue(client)
    before = account_client("ordinary")
    capture(client, token)
    assert client.get("/api/admin/legacy-profiles").status_code == 403
    assert (
        client.post(
            f"/api/admin/legacy-profiles/{legacy['id']}/claim-links",
            json={"acknowledge": True},
            headers=HEADERS,
        ).status_code
        == 403
    )
    assert (
        client.delete(
            f"/api/admin/legacy-profiles/{legacy['id']}/claim-links", headers=HEADERS
        ).status_code
        == 403
    )
    assert (
        client.delete("/api/legacy-claims/capture", headers=HEADERS).status_code == 200
    )
    assert client.get("/api/legacy-claims/preview").status_code == 400
    assert client.get("/api/account").json()["profile_id"] == before["profile_id"]


def test_requests_are_private_neutral_deduplicated_and_throttled(
    client, account_client
):
    account_client("requester")
    for name in ["Unknown learner", "Known learner", "Another learner"]:
        response = client.post(
            "/api/legacy-requests",
            json={"profile_name": name, "note": "Please help"},
            headers=HEADERS,
        )
        assert response.status_code == 202
        assert response.json() == {"accepted": True}
    assert (
        client.post(
            "/api/legacy-requests", json={"profile_name": "Again"}, headers=HEADERS
        ).status_code
        == 429
    )
    assert client.get("/api/admin/legacy-requests").status_code == 403
    with client.app.state.sessions() as db:
        assert count(db, LegacyRequest) == 1
    signin(client)
    requests = client.get("/api/admin/legacy-requests").json()
    assert len(requests) == 1
    result = client.patch(
        f"/api/admin/legacy-requests/{requests[0]['id']}",
        json={"status": "rejected"},
        headers=HEADERS,
    )
    assert result.status_code == 200
    assert result.json() == {"status": "rejected"}


def test_concurrent_redemption_assigns_exactly_one_owner(client):
    legacy, token = issue(client)
    barrier = Barrier(2)

    def redeem(subject):
        with TestClient(client.app) as other:
            signin(other, subject)
            other.get("/api/auth/session")
            capture(other, token)
            barrier.wait(timeout=10)
            return other.post("/api/legacy-claims/redeem", headers=HEADERS).status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(redeem, ["simultaneous-A", "simultaneous-B"]))
    assert sorted(results) == [200, 409]
    with client.app.state.sessions() as db:
        assert count(db, Account, Account.profile_id == UUID(legacy["id"])) == 1
        assert db.get(ClaimLink, digest(token)).consumed_at is not None


def test_transaction_failure_rolls_back_ownership_and_token(
    client, account_client, monkeypatch
):
    import app.legacy_claims as claims

    legacy, token = issue(client)
    before = account_client("rollback-claimant")
    capture(client, token)
    original = claims.audit

    def failure(db, actor, event, resource=None):
        if event == "legacy_claim_redeemed":
            raise RuntimeError("injected transaction failure")
        return original(db, actor, event, resource)

    monkeypatch.setattr(claims, "audit", failure)
    with pytest.raises(RuntimeError, match="injected transaction failure"):
        client.post("/api/legacy-claims/redeem", headers=HEADERS)
    assert client.get("/api/account").json()["profile_id"] == before["profile_id"]
    with client.app.state.sessions() as db:
        assert db.get(ClaimLink, digest(token)).consumed_at is None
        assert count(db, ClaimContinuation) == 1


def test_claim_preserves_reviews_sessions_and_profile_settings(client, account_client):
    from app.models import LearningProgress, PracticeSession, ReviewEvent

    signin(client)
    original = client.get("/api/account").json()
    profile_id = original["profile_id"]
    client.patch(
        f"/api/profiles/{profile_id}",
        json={
            "display_name": "Legacy learner",
            "preferred_direction": "italian_to_greek",
        },
        headers=HEADERS,
    )
    session = client.post(
        "/api/sessions",
        json={"profile_id": profile_id, "direction": "greek_to_italian", "size": 10},
        headers=HEADERS,
    ).json()
    card = f"/api/sessions/{session['id']}/cards/0"
    assert (
        client.post(
            card + "/reveal", json={"direction": "greek_to_italian"}, headers=HEADERS
        ).status_code
        == 200
    )
    assert (
        client.post(
            card + "/reviews",
            json={"direction": "greek_to_italian", "rating": "hard"},
            headers=HEADERS,
        ).status_code
        == 200
    )
    with client.app.state.sessions.begin() as db:
        admin = db.get(Account, UUID(original["id"]))
        empty = Profile(display_name="Administrator")
        db.add(empty)
        db.flush()
        admin.profile_id = empty.id
    issued = client.post(
        f"/api/admin/legacy-profiles/{profile_id}/claim-links",
        json={"acknowledge": True},
        headers=HEADERS,
    )
    assert issued.status_code == 200, issued.text
    token = issued.json()["claim_url"].split("#token=")[1]
    account_client("history-owner")
    assert (
        client.patch(
            "/api/account", json={"interface_language": "it"}, headers=HEADERS
        ).status_code
        == 200
    )
    capture(client, token)
    assert (
        client.get("/api/legacy-claims/preview").json()["profile"]["review_count"] == 1
    )
    assert client.post("/api/legacy-claims/redeem", headers=HEADERS).status_code == 200
    account = client.get("/api/account").json()
    assert account["interface_language"] == "it"
    profile = client.get(f"/api/profiles/{profile_id}").json()
    assert profile["display_name"] == "Legacy learner"
    assert profile["preferred_direction"] == "italian_to_greek"
    assert (
        client.get(f"/api/profiles/{profile_id}/progress").json()["total_reviews"] == 1
    )
    with client.app.state.sessions() as db:
        assert count(db, ReviewEvent, ReviewEvent.profile_id == UUID(profile_id)) == 1
        assert (
            count(db, PracticeSession, PracticeSession.profile_id == UUID(profile_id))
            == 1
        )
        assert (
            count(db, LearningProgress, LearningProgress.profile_id == UUID(profile_id))
            == 1
        )


def test_waiting_practice_rechecks_live_profile_ownership(client, account_client):
    from threading import Event

    from sqlalchemy import event

    from app.models import PracticeSession

    legacy, _ = issue(client)
    account = account_client("waiting-practice")
    old_id = UUID(account["profile_id"])
    sessions = client.app.state.sessions
    engine = sessions.kw["bind"]
    waiting = Event()

    def observe(_connection, _cursor, statement, _parameters, _context, _many):
        if "FOR UPDATE" in statement and "accounts" in statement:
            waiting.set()

    with sessions.begin() as holder:
        row = holder.get(Account, UUID(account["id"]), with_for_update=True)
        event.listen(engine, "before_cursor_execute", observe)
        pool = ThreadPoolExecutor(max_workers=1)
        future = pool.submit(
            lambda: client.post(
                "/api/sessions",
                json={
                    "profile_id": str(old_id),
                    "direction": "greek_to_italian",
                    "size": 10,
                },
                headers=HEADERS,
            )
        )
        assert waiting.wait(timeout=10)
        row.profile_id = UUID(legacy["id"])
    try:
        assert future.result(timeout=10).status_code == 404
        with sessions() as db:
            assert count(db, PracticeSession, PracticeSession.profile_id == old_id) == 0
    finally:
        event.remove(engine, "before_cursor_execute", observe)
        pool.shutdown(wait=True)


def test_claimed_legacy_profile_cannot_be_abandoned_to_claim_another(
    client, account_client
):
    legacy, token = issue(client)
    account_client("one-legacy-owner")
    capture(client, token)
    assert client.post("/api/legacy-claims/redeem", headers=HEADERS).status_code == 200
    with client.app.state.sessions.begin() as db:
        other = Profile(display_name="Another legacy learner", is_legacy=True)
        db.add(other)
        db.flush()
        other_id = other.id
    signin(client)
    response = client.post(
        f"/api/admin/legacy-profiles/{other_id}/claim-links",
        json={"acknowledge": True},
        headers=HEADERS,
    )
    assert response.status_code == 200
    other_token = response.json()["claim_url"].split("#token=")[1]
    signin(client, "one-legacy-owner")
    capture(client, other_token)
    response = client.post("/api/legacy-claims/redeem", headers=HEADERS)
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "account_already_associated"
    assert client.get("/api/account").json()["profile_id"] == legacy["id"]
    with client.app.state.sessions() as db:
        assert db.get(ClaimLink, digest(other_token)).consumed_at is None
    signin(client)
    history = client.get("/api/admin/claim-links").json()
    assert {row["status"] for row in history} == {"used", "pending"}
    assert all("token_hash" not in row for row in history)


@pytest.mark.parametrize("admin_action", ["revoke", "regenerate"])
def test_waiting_claim_observes_committed_revocation(
    client, account_client, admin_action
):
    from threading import Event

    from sqlalchemy import event

    legacy, token = issue(client)
    account = account_client("waiting-claimant")
    capture(client, token)
    sessions = client.app.state.sessions
    engine = sessions.kw["bind"]
    waiting = Event()

    def observe(_connection, _cursor, statement, _parameters, _context, _many):
        if "FOR UPDATE" in statement and "accounts" in statement:
            waiting.set()

    with ThreadPoolExecutor(max_workers=1) as pool:
        try:
            with sessions.begin() as holder:
                holder.get(Account, UUID(account["id"]), with_for_update=True)
                event.listen(engine, "before_cursor_execute", observe)
                future = pool.submit(
                    lambda: client.post("/api/legacy-claims/redeem", headers=HEADERS)
                )
                # Redemption has already loaded the link, but cannot yet lock
                # the account. Revocation must win once it commits here.
                assert waiting.wait(timeout=10)
                with TestClient(client.app) as administrator:
                    signin(administrator)
                    path = f"/api/admin/legacy-profiles/{legacy['id']}/claim-links"
                    if admin_action == "revoke":
                        changed = administrator.delete(path, headers=HEADERS)
                    else:
                        changed = administrator.post(
                            path, json={"acknowledge": True}, headers=HEADERS
                        )
                    assert changed.status_code == 200
            response = future.result(timeout=10)
            assert response.status_code == 400
            assert response.json()["error"]["code"] == "claim_revoked"
            assert (
                client.get("/api/account").json()["profile_id"] == account["profile_id"]
            )
            with sessions() as db:
                link = db.get(ClaimLink, digest(token))
                assert link.revoked_at is not None
                assert link.consumed_at is None
                assert count(db, Account, Account.profile_id == UUID(legacy["id"])) == 0
        finally:
            event.remove(engine, "before_cursor_execute", observe)
