"""The fast path must use fresh provider data for the current login method."""

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.auth import AuthGate


def method(**changes):
    values = {
        "recipe_id": "emailpassword",
        "recipe_user_id": SimpleNamespace(get_as_string=lambda: "current"),
        "email": "synthetic@example.invalid",
        "phone_number": None,
        "verified": True,
    }
    return SimpleNamespace(**(values | changes))


def gate():
    return AuthGate(None, None, ready=True)


@pytest.mark.parametrize("recipe", ["emailpassword", "thirdparty"])
def test_live_user_lookup_tracks_verification_without_caching(monkeypatch, recipe):
    import supertokens_python.asyncio as provider

    current = method(recipe_id=recipe)
    get_user = AsyncMock(
        return_value=SimpleNamespace(is_primary_user=False, login_methods=[current])
    )
    monkeypatch.setattr(provider, "get_user", get_user)
    session = SimpleNamespace(
        get_recipe_user_id=lambda: SimpleNamespace(get_as_string=lambda: "current")
    )
    assert asyncio.run(gate()._verified(session)) is True
    current.verified = False
    assert asyncio.run(gate()._verified(session)) is False
    current.verified = "true"  # malformed provider data must fail closed
    assert asyncio.run(gate()._verified(session)) is False
    assert get_user.await_count == 3
    get_user.assert_awaited_with("current")


@pytest.mark.parametrize(
    "user",
    [
        None,
        SimpleNamespace(is_primary_user=False, login_methods=[]),
        SimpleNamespace(is_primary_user=True, login_methods=[method()]),
        SimpleNamespace(
            is_primary_user=False, login_methods=[method(recipe_id="passwordless")]
        ),
        SimpleNamespace(is_primary_user=False, login_methods=[method(email=None)]),
        SimpleNamespace(
            is_primary_user=False, login_methods=[method(phone_number="synthetic")]
        ),
        SimpleNamespace(is_primary_user=False, login_methods=[method(), method()]),
        SimpleNamespace(
            is_primary_user=False,
            login_methods=[
                method(recipe_user_id=SimpleNamespace(get_as_string=lambda: "other"))
            ],
        ),
    ],
)
def test_ambiguous_login_method_uses_original_verification(monkeypatch, user):
    import supertokens_python.asyncio as provider
    import supertokens_python.recipe.emailverification.asyncio as verification

    monkeypatch.setattr(provider, "get_user", AsyncMock(return_value=user))
    original = AsyncMock(return_value=False)
    monkeypatch.setattr(verification, "is_email_verified", original)
    recipe_id = SimpleNamespace(get_as_string=lambda: "current")
    session = SimpleNamespace(get_recipe_user_id=lambda: recipe_id)
    assert asyncio.run(gate()._verified(session)) is False
    original.assert_awaited_once_with(recipe_id)


def test_provider_failure_never_authenticates(monkeypatch):
    import supertokens_python.asyncio as provider

    monkeypatch.setattr(
        provider, "get_user", AsyncMock(side_effect=RuntimeError("unavailable"))
    )
    session = SimpleNamespace(
        get_recipe_user_id=lambda: SimpleNamespace(get_as_string=lambda: "current")
    )
    with pytest.raises(RuntimeError):
        asyncio.run(gate()._verified(session))
