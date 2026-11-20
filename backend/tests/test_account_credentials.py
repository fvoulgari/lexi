from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from conftest import TEST_CSRF, TEST_SESSIONS
from supertokens_python.recipe.emailpassword.interfaces import (
    SignInOkResult,
    UpdateEmailOrPasswordOkResult,
    WrongCredentialsError,
)
from supertokens_python.types import RecipeUserId

HEADERS = {"X-CSRF-Token": TEST_CSRF, "rid": "session"}
BODY = {
    "current_password": "old synthetic password",
    "new_password": "new synthetic password",
    "confirmation": "new synthetic password",
}


def method(kind="emailpassword", recipe_id="test-admin", tenant="public"):
    return SimpleNamespace(
        recipe_id=kind,
        recipe_user_id=RecipeUserId(recipe_id),
        tenant_ids=[tenant],
        email="synthetic@example.invalid",
        third_party=SimpleNamespace(id="google") if kind == "thirdparty" else None,
    )


@pytest.fixture
def provider(monkeypatch, logged_in):
    user = SimpleNamespace(id="test-admin", login_methods=[method()])
    get = AsyncMock(return_value=user)
    verify = AsyncMock(return_value=SignInOkResult(user, RecipeUserId("test-admin")))
    update = AsyncMock(return_value=UpdateEmailOrPasswordOkResult())
    revoke = AsyncMock()
    monkeypatch.setattr("supertokens_python.asyncio.get_user", get)
    monkeypatch.setattr(
        "supertokens_python.recipe.emailpassword.asyncio.verify_credentials", verify
    )
    monkeypatch.setattr(
        "supertokens_python.recipe.emailpassword.asyncio.update_email_or_password",
        update,
    )
    monkeypatch.setattr(
        "supertokens_python.recipe.session.asyncio.revoke_all_sessions_for_user", revoke
    )
    return SimpleNamespace(
        user=user, get=get, verify=verify, update=update, revoke=revoke
    )


def test_own_password_credentials_from_provider(logged_in, provider):
    response = logged_in.get("/api/account/credentials")
    assert response.status_code == 200
    assert response.json()["can_change_password"] is True
    assert response.json()["email"] == "synthetic@example.invalid"
    assert response.json()["sign_in_methods"] == ["password"]
    provider.get.assert_awaited_once_with("test-admin")


def test_google_only_matching_email_never_creates_password(logged_in, provider):
    provider.user.login_methods = [method("thirdparty")]
    data = logged_in.get("/api/account/credentials").json()
    assert data["sign_in_methods"] == ["google"]
    assert data["can_change_password"] is False
    assert (
        logged_in.post("/api/account/password", json=BODY, headers=HEADERS).status_code
        == 403
    )
    provider.verify.assert_not_awaited()
    provider.update.assert_not_awaited()
    provider.revoke.assert_not_awaited()


def test_actual_password_available_after_google_login(logged_in, provider):
    provider.user.login_methods = [
        method("thirdparty"),
        method(recipe_id="password-id"),
    ]
    assert (
        logged_in.get("/api/account/credentials").json()["can_change_password"] is True
    )
    provider.verify.return_value = SignInOkResult(
        provider.user, RecipeUserId("password-id")
    )
    assert (
        logged_in.post("/api/account/password", json=BODY, headers=HEADERS).status_code
        == 200
    )
    assert provider.update.await_args.args[0] == RecipeUserId("password-id")


def test_password_change_verifies_and_revokes_sessions(logged_in, provider):
    assert (
        logged_in.post("/api/account/password", json=BODY, headers=HEADERS).status_code
        == 200
    )
    provider.verify.assert_awaited_once_with(
        "public", "synthetic@example.invalid", BODY["current_password"]
    )
    provider.update.assert_awaited_once_with(
        RecipeUserId("test-admin"),
        password=BODY["new_password"],
        apply_password_policy=True,
        tenant_id_for_password_policy="public",
    )
    provider.revoke.assert_awaited_once_with("test-admin")
    assert not TEST_SESSIONS
    assert logged_in.get("/api/account/credentials").status_code == 401


@pytest.mark.parametrize(
    "different", ["wrong-password", "other-account", "other-credential"]
)
def test_foreign_identity_or_wrong_password_cannot_change(
    logged_in, provider, different
):
    if different == "wrong-password":
        provider.verify.return_value = WrongCredentialsError()
    elif different == "other-account":
        provider.verify.return_value = SignInOkResult(
            SimpleNamespace(id="someone-else"), RecipeUserId("test-admin")
        )
    else:
        provider.verify.return_value = SignInOkResult(
            provider.user, RecipeUserId("someone-else")
        )
    response = logged_in.post("/api/account/password", json=BODY, headers=HEADERS)
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "current_password_incorrect"
    provider.update.assert_not_awaited()
    provider.revoke.assert_not_awaited()
    assert TEST_SESSIONS


@pytest.mark.parametrize(
    "body",
    [
        {**BODY, "confirmation": "different new password"},
        {**BODY, "new_password": "short"},
        {**BODY, "user_id": "someone-else"},
    ],
)
def test_validation_never_reaches_provider_update(logged_in, provider, body):
    assert (
        logged_in.post("/api/account/password", json=body, headers=HEADERS).status_code
        == 422
    )
    provider.update.assert_not_awaited()


def test_password_change_requires_csrf_and_throttles(logged_in, provider):
    assert logged_in.post("/api/account/password", json=BODY).status_code == 403
    assert (
        logged_in.post(
            "/api/account/password",
            json=BODY,
            headers={**HEADERS, "Origin": "https://foreign.invalid"},
        ).status_code
        == 403
    )
    provider.verify.return_value = WrongCredentialsError()
    for _ in range(5):
        assert (
            logged_in.post(
                "/api/account/password", json=BODY, headers=HEADERS
            ).status_code
            == 400
        )
    assert (
        logged_in.post("/api/account/password", json=BODY, headers=HEADERS).status_code
        == 429
    )
    assert provider.verify.await_count == 5


def test_other_tenant_password_is_not_available(logged_in, provider):
    provider.user.login_methods = [
        method("thirdparty"),
        method(recipe_id="other", tenant="foreign"),
    ]
    assert (
        logged_in.get("/api/account/credentials").json()["can_change_password"] is False
    )
    assert (
        logged_in.post("/api/account/password", json=BODY, headers=HEADERS).status_code
        == 403
    )


def test_wrong_provider_identity_fails_closed(logged_in, provider):
    provider.get.return_value = SimpleNamespace(
        id="someone-else", login_methods=[method()]
    )
    assert logged_in.get("/api/account/credentials").status_code == 401
    provider.update.assert_not_awaited()


def test_provider_outage_is_retryable_and_does_not_report_success(logged_in, provider):
    provider.verify.side_effect = RuntimeError("private provider diagnostic")
    response = logged_in.post("/api/account/password", json=BODY, headers=HEADERS)
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "authentication_unavailable"
    assert "private provider diagnostic" not in response.text
    provider.update.assert_not_awaited()
    provider.revoke.assert_not_awaited()


def test_unknown_credential_or_missing_provider_record_cannot_update(
    logged_in, provider
):
    provider.get.return_value = None
    assert (
        logged_in.post("/api/account/password", json=BODY, headers=HEADERS).status_code
        == 401
    )
    provider.update.assert_not_awaited()
