"""Provider contracts and enforcement without live Core or email delivery."""

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from supertokens_python.recipe.emailpassword.interfaces import (
    EmailAlreadyExistsError,
    SignUpOkResult,
)
from supertokens_python.recipe.emailpassword.types import FormField

from app.auth import AuthGate, initialize_auth
from app.auth_email import AuthEmailDelivery, EmailDeliveryUnavailable
from app.auth_provider import restrict_emailpassword, validate_password
from app.config import Settings


def config(**values):
    return Settings(
        _env_file=None,
        database_url="postgresql://test:test@localhost/test",
        public_origin="https://lexi.example",
        resend_api_key="test-only-key",
        email_from="Lexi <test@example.invalid>",
        **values,
    )


def apis(**values):
    return restrict_emailpassword(
        SimpleNamespace(
            sign_in_post=AsyncMock(),
            generate_password_reset_token_post=AsyncMock(),
            password_reset_post=AsyncMock(),
            **values,
        )
    )


@pytest.mark.parametrize(
    "password,valid",
    [
        ("short", False),
        ("x" * 14, False),
        ("spaces and unicode Ελληνικά", True),
        ("x" * 128, True),
        ("x" * 129, False),
    ],
)
def test_password_policy(password, valid):
    assert (asyncio.run(validate_password(password, "public")) is None) == valid


@pytest.mark.parametrize("new", [True, False])
def test_registration_is_generic_and_never_creates_session(new, monkeypatch):
    import supertokens_python.recipe.emailverification.asyncio as ev

    mail = AsyncMock()
    monkeypatch.setattr(ev, "send_email_verification_email", mail)
    recipe_user_id = SimpleNamespace()
    result = (
        SignUpOkResult(
            user=SimpleNamespace(id="provider-id"), recipe_user_id=recipe_user_id
        )
        if new
        else EmailAlreadyExistsError()
    )
    signup = AsyncMock(return_value=result)
    response = asyncio.run(
        apis().sign_up_post(
            [
                FormField("email", "learner@example.invalid"),
                FormField("password", "long test password"),
            ],
            "public",
            None,
            False,
            SimpleNamespace(recipe_implementation=SimpleNamespace(sign_up=signup)),
            {},
        )
    )
    assert response.to_json() == {"status": "OK"}
    assert signup.call_args.kwargs["session"] is None
    assert signup.call_args.kwargs["should_try_linking_with_session_user"] is False
    assert mail.await_count == int(new)


def test_recovery_delivery_failure_is_not_an_account_oracle():
    original = AsyncMock(side_effect=EmailDeliveryUnavailable())
    api = restrict_emailpassword(
        SimpleNamespace(
            sign_in_post=AsyncMock(),
            generate_password_reset_token_post=original,
            password_reset_post=AsyncMock(),
        )
    )
    assert asyncio.run(api.generate_password_reset_token_post()).to_json() == {
        "status": "OK"
    }


def test_successful_password_reset_revokes_existing_sessions(monkeypatch):
    import supertokens_python.recipe.session.asyncio as session

    revoke = AsyncMock()
    monkeypatch.setattr(session, "revoke_all_sessions_for_user", revoke)
    api = restrict_emailpassword(
        SimpleNamespace(
            sign_in_post=AsyncMock(),
            generate_password_reset_token_post=AsyncMock(),
            password_reset_post=AsyncMock(
                return_value=SimpleNamespace(
                    status="OK", user=SimpleNamespace(id="password-account")
                )
            ),
        )
    )
    asyncio.run(api.password_reset_post())
    revoke.assert_awaited_once_with("password-account")


def test_unverified_identity_cannot_provision_or_read_account():
    gate = AuthGate(config(), None, ready=True)
    gate._session = AsyncMock(
        return_value=SimpleNamespace(get_user_id=lambda: "unverified")
    )
    gate._verified = AsyncMock(return_value=False)
    request = SimpleNamespace(state=SimpleNamespace())
    with pytest.raises(HTTPException) as error:
        asyncio.run(gate.require(request))
    assert error.value.status_code == 403
    assert error.value.detail["code"] == "email_verification_required"
    from fastapi import Response

    assert asyncio.run(gate.state(request, Response())) == {
        "authenticated": False,
        "auth_available": True,
        "csrf_token": "supertokens",
        "verification_required": True,
    }


@pytest.mark.parametrize("verification", [True, False])
def test_email_uses_fixed_https_endpoint_and_sanitizes_failure(
    monkeypatch, verification
):
    payloads = []

    async def post(self, url, **kwargs):
        assert url == "https://api.resend.com/emails"
        payloads.append(kwargs)
        return httpx.Response(429, text="secret-provider-response")

    monkeypatch.setattr(httpx.AsyncClient, "post", post)
    template = SimpleNamespace(user=SimpleNamespace(email="synthetic@example.invalid"))
    setattr(
        template,
        "email_verify_link" if verification else "password_reset_link",
        "https://lexi.example/auth/verify-email?token=test-bearer",
    )
    with pytest.raises(EmailDeliveryUnavailable) as error:
        asyncio.run(AuthEmailDelivery(config()).send_email(template, {}))
    assert str(error.value) == "Email delivery unavailable"
    assert payloads[0]["json"]["to"] == ["synthetic@example.invalid"]
    assert "test-bearer" in payloads[0]["json"]["text"]


def test_email_rejects_foreign_origin_before_delivery():
    template = SimpleNamespace(
        email_verify_link="https://evil.invalid/?token=test",
        user=SimpleNamespace(email="test@example.invalid"),
    )
    with pytest.raises(ValueError):
        asyncio.run(AuthEmailDelivery(config()).send_email(template, {}))


def test_removed_magic_link_endpoints_always_return_404():
    from fastapi import FastAPI

    app = FastAPI()
    initialize_auth(app, config(), None)
    with TestClient(app) as client:
        for prefix in ("", "public/"):
            for suffix in (
                "signinup/code",
                "signinup/code/resend",
                "signinup/code/consume",
                "passwordless/email/exists",
            ):
                assert client.post("/api/auth/" + prefix + suffix).status_code == 404


def test_auth_rate_limit_covers_password_recovery_and_public_aliases():
    from fastapi import FastAPI

    app = FastAPI()
    gate = initialize_auth(app, config(), None)
    gate.ready = True
    gate.throttle = lambda _: False
    with TestClient(app) as client:
        for prefix in ("", "public/"):
            for suffix in (
                "signup",
                "signin",
                "user/password/reset/token",
                "user/password/reset",
                "user/email/verify/token",
                "user/email/verify",
            ):
                result = client.post("/api/auth/" + prefix + suffix)
                assert result.status_code == 429
                assert result.headers["retry-after"] == "60"
