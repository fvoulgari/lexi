"""Identifier backoff uses no account lookup, raw identifier storage or lockout."""

import asyncio
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import select, update
from supertokens_python.recipe.emailpassword.interfaces import (
    SignInPostOkResult,
    WrongCredentialsError,
)
from supertokens_python.recipe.emailpassword.types import FormField

from app.auth_provider import restrict_emailpassword
from app.models import LoginThrottle
from app.password_attempts import PasswordAttempts


@pytest.mark.parametrize("email", ["known@example.invalid", "unknown@example.invalid"])
def test_failure_backoff_is_bounded_and_identifier_is_not_stored(client, email):
    attempts = PasswordAttempts(client.app.state.sessions, "local-test-key")
    assert [attempts.record_failure("public", email) for _ in range(8)] == [
        0,
        0,
        0,
        0.25,
        0.5,
        1,
        1,
        1,
    ]
    assert attempts.record_failure("public", "other@example.invalid") == 0
    assert attempts.record_failure("other-tenant", email) == 0
    with client.app.state.sessions() as db:
        rows = list(db.scalars(select(LoginThrottle)))
        assert len(rows) == 3
        assert all(len(row.client_hash) == 64 for row in rows)
        assert all(email not in row.client_hash for row in rows)
    with client.app.state.sessions.begin() as db:
        db.execute(
            update(LoginThrottle).values(
                window_start=datetime.now(UTC) - timedelta(minutes=6)
            )
        )
    assert attempts.record_failure("public", email) == 0


def test_failure_counter_is_atomic_and_case_variants_share_it(client):
    attempts = PasswordAttempts(client.app.state.sessions, "local-test-key")
    with ThreadPoolExecutor(max_workers=6) as pool:
        delays = list(
            pool.map(
                lambda _: attempts.record_failure(
                    "public", "Synthetic@example.invalid"
                ),
                range(6),
            )
        )
    assert sorted(delays) == [0, 0, 0, 0.25, 0.5, 1]
    assert attempts.record_failure("public", " synthetic@EXAMPLE.invalid ") == 1
    other_key = PasswordAttempts(client.app.state.sessions, "another-local-test-key")
    assert other_key.record_failure("public", "synthetic@example.invalid") == 0


@pytest.mark.parametrize("email", ["known@example.invalid", "unknown@example.invalid"])
def test_only_wrong_credentials_receive_backoff(client, monkeypatch, email):
    attempts = PasswordAttempts(client.app.state.sessions, "local-test-key")
    sleep = AsyncMock()
    monkeypatch.setattr("app.password_attempts.asyncio.sleep", sleep)
    success = SignInPostOkResult(
        user=SimpleNamespace(id="synthetic-provider"),
        session=SimpleNamespace(),
    )
    original = AsyncMock(side_effect=[WrongCredentialsError()] * 6 + [success])
    api = restrict_emailpassword(
        SimpleNamespace(
            sign_in_post=original,
            generate_password_reset_token_post=AsyncMock(),
            password_reset_post=AsyncMock(),
        ),
        attempts,
    )
    args = dict(
        form_fields=[FormField("email", email), FormField("password", "test password")],
        tenant_id="public",
        session=None,
        should_try_linking_with_session_user=False,
        api_options=SimpleNamespace(),
        user_context={},
    )
    for index in range(6):
        result = asyncio.run(
            api.sign_in_post(**args) if index % 2 else api.sign_in_post(*args.values())
        )
        assert result.to_json() == {"status": "WRONG_CREDENTIALS_ERROR"}
    assert [call.args[0] for call in sleep.await_args_list] == [0.25, 0.5, 1]
    assert asyncio.run(api.sign_in_post(**args)) is success
    assert sleep.await_count == 3  # Valid credentials bypass backoff, never lock out.
    with client.app.state.sessions() as db:
        assert db.scalars(select(LoginThrottle)).one().attempts == 6


def test_provider_failure_does_not_record_wrong_password(client):
    attempts = None
    api = restrict_emailpassword(
        SimpleNamespace(
            sign_in_post=AsyncMock(
                side_effect=RuntimeError("synthetic service failure")
            ),
            generate_password_reset_token_post=AsyncMock(),
            password_reset_post=AsyncMock(),
        ),
        attempts,
    )
    with pytest.raises(RuntimeError, match="synthetic service failure"):
        asyncio.run(api.sign_in_post())


def test_identifier_slot_blocks_concurrent_guesses_but_not_other_identifiers(client):
    from app.password_attempts import PasswordAttemptBusy

    attempts = PasswordAttempts(client.app.state.sessions, "local-test-key")

    async def scenario():
        async with attempts.attempt("public", "Synthetic@example.invalid") as db:
            with pytest.raises(PasswordAttemptBusy):
                async with attempts.attempt("public", " synthetic@EXAMPLE.invalid "):
                    pytest.fail("Concurrent provider verification was admitted")
            async with attempts.attempt("public", "other@example.invalid"):
                pass
            await attempts.failed("public", "Synthetic@example.invalid", db)
        async with attempts.attempt("public", "synthetic@example.invalid"):
            pass

    asyncio.run(scenario())
    with client.app.state.sessions() as db:
        assert db.scalars(select(LoginThrottle)).one().attempts == 1


def test_cancelled_slot_acquisition_releases_lock_even_with_repeated_cancel(client):
    import threading

    attempts = PasswordAttempts(client.app.state.sessions, "local-test-key")
    acquired, proceed, released = (
        threading.Event(),
        threading.Event(),
        threading.Event(),
    )
    original_acquire, original_release = attempts.acquire, attempts.release

    def acquire(identifier):
        slot = original_acquire(identifier)
        acquired.set()
        assert proceed.wait(5)
        return slot

    def release(slot):
        original_release(slot)
        released.set()

    attempts.acquire, attempts.release = acquire, release

    async def operation():
        async with attempts.attempt("public", "cancel@example.invalid"):
            pytest.fail("Cancelled request must not verify credentials")

    async def scenario():
        task = asyncio.create_task(operation())
        assert await asyncio.to_thread(acquired.wait, 5)
        task.cancel()
        await asyncio.sleep(0)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        proceed.set()
        assert await asyncio.to_thread(released.wait, 5)

    asyncio.run(scenario())
    slot = original_acquire(attempts.identifier("public", "cancel@example.invalid"))
    original_release(slot)


def test_cancellation_finishes_failure_sql_before_releasing_session(client):
    import threading

    attempts = PasswordAttempts(client.app.state.sessions, "local-test-key")
    started, proceed, finished = threading.Event(), threading.Event(), threading.Event()
    original_record, original_release = attempts.record_failure, attempts.release

    def record(*args):
        started.set()
        assert proceed.wait(5)
        result = original_record(*args)
        finished.set()
        return result

    def release(slot):
        assert finished.is_set(), "Unlock must not race failure SQL on the same Session"
        original_release(slot)

    attempts.record_failure, attempts.release = record, release

    async def operation():
        async with attempts.attempt("public", "cancel-sql@example.invalid") as db:
            await attempts.failed("public", "cancel-sql@example.invalid", db)

    async def scenario():
        task = asyncio.create_task(operation())
        assert await asyncio.to_thread(started.wait, 5)
        task.cancel()
        await asyncio.sleep(0)
        task.cancel()
        await asyncio.sleep(0)
        assert not task.done()
        proceed.set()
        with pytest.raises(asyncio.CancelledError):
            await task

    asyncio.run(scenario())
    slot = attempts.acquire(attempts.identifier("public", "cancel-sql@example.invalid"))
    original_release(slot)


def test_provider_timeout_releases_slot_without_recording_password_failure(
    client, monkeypatch
):
    from app.password_attempts import PasswordVerificationUnavailable

    attempts = PasswordAttempts(client.app.state.sessions, "local-test-key")
    timeout = asyncio.timeout
    monkeypatch.setattr("app.auth_provider.asyncio.timeout", lambda _: timeout(0.01))

    async def stalled(**kwargs):
        await asyncio.Event().wait()

    api = restrict_emailpassword(
        SimpleNamespace(
            sign_in_post=stalled,
            generate_password_reset_token_post=AsyncMock(),
            password_reset_post=AsyncMock(),
        ),
        attempts,
    )
    with pytest.raises(PasswordVerificationUnavailable):
        asyncio.run(
            api.sign_in_post(
                form_fields=[
                    FormField("email", "timeout@example.invalid"),
                    FormField("password", "synthetic"),
                ],
                tenant_id="public",
            )
        )
    slot = attempts.acquire(attempts.identifier("public", "timeout@example.invalid"))
    attempts.release(slot)
    with client.app.state.sessions() as db:
        assert list(db.scalars(select(LoginThrottle))) == []
