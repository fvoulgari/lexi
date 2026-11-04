"""Exercise the HTTP boundary with a test-only provider session substitute."""

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi import Depends, FastAPI, Request
from fastapi.testclient import TestClient

from app.access import account_context
from app.auth import AuthGate, initialize_auth
from app.auth_provider import configuration_ready
from app.config import Settings


def settings(**changes):
    changes.setdefault("cookie_secure", True)
    return Settings(
        _env_file=None,
        database_url="postgresql://test:test@localhost/test",
        **({"cookie_secure": True} | changes),
    )


def test_unconfigured_auth_never_accepts_shared_password():
    app = FastAPI()
    gate = initialize_auth(app, settings(), None)
    app.get("/api/auth/session")(gate.state)

    @app.get("/private", dependencies=[Depends(gate.require)])
    def private():
        return {"secret": True}

    with TestClient(app) as client:
        result = client.get("/api/auth/session")
        assert result.status_code == 200
        assert result.json()["authenticated"] is False
        assert result.json()["auth_available"] is False
        assert result.headers["cache-control"] == "no-store"
        assert (
            client.post("/api/auth/login", json={"password": "anything"}).status_code
            == 503
        )
        assert client.get("/private").status_code == 503


def test_production_configuration_requires_tls_and_explicit_email_service():
    complete = dict(
        public_origin="https://lexi.example",
        supertokens_connection_uri="https://core.example",
        supertokens_api_key="core-key",
        google_client_id="google-id",
        google_client_secret="google-secret",
        smtp_host="smtp.example",
        smtp_from_email="lexi@example.com",
    )
    assert configuration_ready(settings(**complete))
    assert not configuration_ready(settings(**(complete | {"smtp_host": ""})))
    assert not configuration_ready(
        settings(**(complete | {"supertokens_connection_uri": "http://core.example"}))
    )


def test_verified_session_always_checks_provider_revocation(monkeypatch):
    import supertokens_python.recipe.session.asyncio as provider

    mock = AsyncMock(return_value=None)
    monkeypatch.setattr(provider, "get_session", mock)
    gate = AuthGate(settings(), None, ready=True)
    request = SimpleNamespace(method="POST")
    asyncio.run(gate._session(request))
    assert mock.call_args.kwargs == {
        "session_required": True,
        "check_database": True,
        "anti_csrf_check": True,
    }


def test_logout_revokes_session_and_all_sessions(monkeypatch):
    import supertokens_python.recipe.session.asyncio as provider

    gate = AuthGate(settings(public_origin="http://testserver"), None, ready=True)
    session = SimpleNamespace(
        get_user_id=lambda: "stable-subject", revoke_session=AsyncMock()
    )
    all_sessions = AsyncMock()
    monkeypatch.setattr(provider, "revoke_all_sessions_for_user", all_sessions)

    async def require(request):
        request.state.auth_session = session
        return SimpleNamespace(id=uuid4())

    gate.require = require
    app = FastAPI()
    app.post("/logout")(gate.logout)
    app.post("/logout-all")(gate.logout_all)
    with TestClient(app) as client:
        assert client.post("/logout").status_code == 403
        assert (
            client.post(
                "/logout", headers={"rid": "session", "Origin": "https://evil.example"}
            ).status_code
            == 403
        )
        assert client.post("/logout", headers={"rid": "session"}).status_code == 200
        assert client.post("/logout-all", headers={"rid": "session"}).status_code == 200
    assert session.revoke_session.await_count == 2
    all_sessions.assert_awaited_once_with("stable-subject")


def test_boundary_clears_context_between_requests():
    app = FastAPI()
    initialize_auth(app, settings(), None)

    @app.get("/identity")
    async def identity(request: Request):
        was_empty = account_context.get() is None
        account_context.set(SimpleNamespace(id="first request"))
        return {"empty": was_empty}

    with TestClient(app) as client:
        assert client.get("/identity").json() == {"empty": True}
        assert client.get("/identity").json() == {"empty": True}
    assert account_context.get() is None


def test_google_callback_allowlist_rejects_external_and_native_token_flows():
    from supertokens_python.exceptions import BadInputError

    from app.auth_provider import restrict_thirdparty

    apis = restrict_thirdparty(
        SimpleNamespace(authorisation_url_get=AsyncMock(), sign_in_up_post=AsyncMock()),
        "https://lexi.example",
    )
    with pytest.raises(BadInputError):
        asyncio.run(
            apis.authorisation_url_get(
                redirect_uri_on_provider_dashboard="https://evil.example"
            )
        )
    with pytest.raises(BadInputError):
        asyncio.run(apis.sign_in_up_post(oauth_tokens={"id_token": "untrusted"}))
    with pytest.raises(BadInputError):
        asyncio.run(
            apis.sign_in_up_post(
                redirect_uri_info=SimpleNamespace(
                    redirect_uri_on_provider_dashboard="https://evil.example"
                ),
            )
        )
    asyncio.run(
        apis.authorisation_url_get(
            redirect_uri_on_provider_dashboard="https://lexi.example/auth/callback/google",
        )
    )


def test_explicit_linking_flags_rejected_for_both_signin_methods():
    from supertokens_python.exceptions import BadInputError

    from app.auth_provider import restrict_passwordless, restrict_thirdparty

    apis = restrict_passwordless(SimpleNamespace(consume_code_post=AsyncMock()))
    with pytest.raises(BadInputError):
        asyncio.run(apis.consume_code_post(should_try_linking_with_session_user=True))
    apis = restrict_thirdparty(
        SimpleNamespace(authorisation_url_get=AsyncMock(), sign_in_up_post=AsyncMock()),
        "https://lexi.example",
    )
    with pytest.raises(BadInputError):
        asyncio.run(apis.sign_in_up_post(should_try_linking_with_session_user=True))


def test_passwordless_recipe_disables_identity_enumeration():
    from app.auth_provider import restrict_passwordless

    apis = restrict_passwordless(SimpleNamespace(consume_code_post=AsyncMock()))
    assert apis.disable_email_exists_get is True
    assert apis.disable_phone_number_exists_get is True


def test_insecure_cookies_are_only_allowed_for_loopback_development():
    complete = dict(
        public_origin="https://lexi.example",
        cookie_secure=False,
        supertokens_connection_uri="https://core.example",
        supertokens_api_key="core-key",
        google_client_id="google-id",
        google_client_secret="google-secret",
        smtp_host="smtp.example",
        smtp_from_email="lexi@example.com",
    )
    assert not configuration_ready(settings(**complete))
    assert configuration_ready(
        settings(**(complete | {"public_origin": "http://localhost:5173"}))
    )


def test_configured_provider_does_not_expose_identity_existence_endpoints():
    app = FastAPI()
    gate = initialize_auth(
        app,
        settings(
            public_origin="https://lexi.example",
            supertokens_connection_uri="https://core.example.invalid",
            supertokens_api_key="test-key-not-a-live-secret",
            google_client_id="test-google-id",
            google_client_secret="test-google-secret",
            smtp_host="smtp.example.invalid",
            smtp_from_email="test@example.invalid",
        ),
        None,
    )
    assert gate.ready
    with TestClient(app, base_url="https://lexi.example") as client:
        for path in (
            "/api/auth/passwordless/email/exists?email=someone@example.com",
            "/api/auth/signup/email/exists?email=someone@example.com",
            "/api/auth/passwordless/phonenumber/exists?phoneNumber=1234",
        ):
            response = client.get(path)
            assert response.status_code == 404
            assert "exists" not in response.json()
