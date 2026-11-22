"""Exercise the HTTP boundary with a test-only provider session substitute."""

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
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
        resend_api_key="test-mail-key",
        email_from="lexi@example.com",
    )
    assert configuration_ready(settings(**complete))
    assert not configuration_ready(settings(**(complete | {"resend_api_key": ""})))
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


def test_optional_session_can_enforce_claims_without_skipping_core(monkeypatch):
    import supertokens_python.recipe.session.asyncio as provider

    mock = AsyncMock(return_value=None)
    monkeypatch.setattr(provider, "get_session", mock)
    gate = AuthGate(settings(), None, ready=True)
    request = SimpleNamespace(method="GET")
    asyncio.run(gate._session(request, required=False, enforce_claims=True))
    asyncio.run(gate._session(request, required=False, enforce_claims=True))
    assert mock.await_count == 2
    assert mock.call_args.kwargs == {
        "session_required": False,
        "check_database": True,
        "anti_csrf_check": False,
    }


def test_authenticated_state_checks_session_and_verification_once():
    profile_id = uuid4()
    account = SimpleNamespace(
        id=uuid4(), profile_id=profile_id, role="learner", interface_language="en"
    )
    session = SimpleNamespace(get_user_id=lambda: "subject")
    db = MagicMock()
    db.get.return_value = SimpleNamespace(display_name="Learner")
    sessions = MagicMock()
    sessions.return_value.__enter__.return_value = db
    gate = AuthGate(settings(), sessions, ready=True)
    gate._session = AsyncMock(return_value=session)
    gate._verified = AsyncMock(return_value=True)
    gate._account = MagicMock(return_value=account)
    request = SimpleNamespace(state=SimpleNamespace())
    response = SimpleNamespace(headers={})
    result = asyncio.run(gate.state(request, response))
    assert result["authenticated"] is True
    gate._session.assert_awaited_once_with(request, required=False, enforce_claims=True)
    gate._verified.assert_awaited_once_with(session)


def test_state_unverified_user_gets_verification_screen_after_invalid_claim():
    from supertokens_python.recipe.session.exceptions import InvalidClaimsError

    session = SimpleNamespace()
    gate = AuthGate(settings(), None, ready=True)
    gate._session = AsyncMock(side_effect=[InvalidClaimsError("invalid", []), session])
    gate._verified = AsyncMock(return_value=False)
    response = SimpleNamespace(headers={})
    result = asyncio.run(gate.state(SimpleNamespace(state=SimpleNamespace()), response))
    assert result["authenticated"] is False
    assert result["verification_required"] is True


def test_state_other_invalid_claim_never_authenticates():
    from supertokens_python.recipe.session.exceptions import InvalidClaimsError

    error = InvalidClaimsError("invalid", [])
    gate = AuthGate(settings(), None, ready=True)
    gate._session = AsyncMock(side_effect=[error, SimpleNamespace()])
    gate._verified = AsyncMock(return_value=True)
    with pytest.raises(InvalidClaimsError):
        asyncio.run(
            gate.state(
                SimpleNamespace(state=SimpleNamespace()), SimpleNamespace(headers={})
            )
        )


def test_revoked_state_session_is_never_provisioned():
    from supertokens_python.recipe.session.exceptions import UnauthorisedError

    gate = AuthGate(settings(), None, ready=True)
    gate._session = AsyncMock(side_effect=UnauthorisedError("revoked"))
    gate._account = MagicMock()
    with pytest.raises(UnauthorisedError):
        asyncio.run(
            gate.state(
                SimpleNamespace(state=SimpleNamespace()), SimpleNamespace(headers={})
            )
        )
    gate._session.assert_awaited_once()
    gate._account.assert_not_called()


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

    from app.auth_provider import restrict_emailpassword, restrict_thirdparty

    apis = restrict_emailpassword(
        SimpleNamespace(
            sign_in_post=AsyncMock(),
            generate_password_reset_token_post=AsyncMock(),
            password_reset_post=AsyncMock(),
        )
    )
    with pytest.raises(BadInputError):
        asyncio.run(apis.sign_in_post(should_try_linking_with_session_user=True))
    apis = restrict_thirdparty(
        SimpleNamespace(authorisation_url_get=AsyncMock(), sign_in_up_post=AsyncMock()),
        "https://lexi.example",
    )
    with pytest.raises(BadInputError):
        asyncio.run(apis.sign_in_up_post(should_try_linking_with_session_user=True))


def test_password_recipe_disables_identity_enumeration():
    from app.auth_provider import restrict_emailpassword

    apis = restrict_emailpassword(
        SimpleNamespace(
            sign_in_post=AsyncMock(),
            generate_password_reset_token_post=AsyncMock(),
            password_reset_post=AsyncMock(),
        )
    )
    assert apis.disable_email_exists_get is True


def test_insecure_cookies_are_only_allowed_for_loopback_development():
    complete = dict(
        public_origin="https://lexi.example",
        cookie_secure=False,
        supertokens_connection_uri="https://core.example",
        supertokens_api_key="core-key",
        google_client_id="google-id",
        google_client_secret="google-secret",
        resend_api_key="test-mail-key",
        email_from="lexi@example.com",
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
            resend_api_key="test-mail-key",
            email_from="test@example.invalid",
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
        gate.throttle = lambda _: False
        for path in (
            "signin",
            "signup",
            "user/password/reset/token",
            "user/password/reset",
            "user/email/verify/token",
            "user/email/verify",
        ):
            for prefix in ("", "public/"):
                assert (
                    client.post("/api/auth/" + prefix + path + "/").status_code == 429
                )


@pytest.mark.parametrize(
    "userinfo,token,expected",
    [
        ({"given_name": "  Μαρία  "}, {}, "Μαρία"),
        ({}, {"given_name": "Ada"}, "Ada"),
        ({"given_name": "   "}, {}, "Learner"),
        ({"given_name": "x" * 81}, {}, "Learner"),
        ({"given_name": 12}, None, "Learner"),
    ],
)
def test_google_first_name_fallbacks(userinfo, token, expected):
    from app.auth_provider import google_first_name

    assert google_first_name(userinfo, token) == expected


def test_google_callback_provisions_once_and_preserves_renamed_profile(client):
    from supertokens_python.recipe.thirdparty.interfaces import SignInUpPostOkResult
    from supertokens_python.recipe.thirdparty.types import RawUserInfoFromProvider

    from app.auth_provider import restrict_thirdparty
    from app.models import Profile

    gate = client.app.state.auth_gate
    session = SimpleNamespace(get_user_id=lambda: "google-new")
    result = SignInUpPostOkResult(
        user=SimpleNamespace(),
        created_new_recipe_user=True,
        session=session,
        oauth_tokens={},
        raw_user_info_from_provider=RawUserInfoFromProvider(
            {}, {"given_name": "  Sofia  "}
        ),
    )
    apis = restrict_thirdparty(
        SimpleNamespace(
            authorisation_url_get=AsyncMock(),
            sign_in_up_post=AsyncMock(return_value=result),
        ),
        "https://lexi.example",
        gate.provision_google,
    )
    arguments = dict(
        provider=SimpleNamespace(id="google"),
        redirect_uri_info=SimpleNamespace(
            redirect_uri_on_provider_dashboard="https://lexi.example/auth/callback/google"
        ),
    )
    assert asyncio.run(apis.sign_in_up_post(**arguments)) is result
    account = gate._account("google-new")
    with gate.sessions.begin() as db:
        profile = db.get(Profile, account.profile_id)
        assert profile.display_name == "Sofia"
        profile.display_name = "Chosen name"
    result.raw_user_info_from_provider.from_user_info_api["given_name"] = (
        "Changed at Google"
    )
    asyncio.run(apis.sign_in_up_post(**arguments))
    with gate.sessions() as db:
        assert db.get(Profile, account.profile_id).display_name == "Chosen name"


def test_unverified_google_session_does_not_provision():
    gate = AuthGate(settings(), None, ready=True)
    gate._verified = AsyncMock(return_value=False)
    gate._account = lambda *_args: pytest.fail("unverified account provisioned")
    asyncio.run(gate.provision_google(SimpleNamespace(), "Sofia"))
