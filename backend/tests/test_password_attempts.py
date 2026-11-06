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
    attempts = SimpleNamespace(failed=AsyncMock())
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
    attempts.failed.assert_not_awaited()
