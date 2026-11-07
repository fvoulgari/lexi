"""Provider-owned account credentials; never infer ownership from matching email."""

from fastapi import HTTPException


async def provider_call(operation):
    try:
        return await operation
    except Exception:
        raise HTTPException(
            503,
            {
                "code": "authentication_unavailable",
                "message": "Please try again shortly.",
            },
        ) from None


def reject(status, code):
    raise HTTPException(status, {"code": code, "message": "Unable to update password."})


async def credentials(session):
    from supertokens_python.asyncio import get_user

    user = await provider_call(get_user(session.get_user_id()))
    if user is None or user.id != session.get_user_id():
        reject(401, "authentication_required")
    methods = [m for m in user.login_methods if session.get_tenant_id() in m.tenant_ids]
    if not methods or not any(
        m.recipe_user_id == session.get_recipe_user_id() for m in methods
    ):
        reject(503, "account_identity_unavailable")
    return user, methods


def password_credential(methods):
    passwords = [m for m in methods if m.recipe_id == "emailpassword"]
    # Do not guess which credential to change if the provider returns ambiguity.
    return passwords[0] if len(passwords) == 1 else None


def identity_output(session, methods):
    active = next(
        (m for m in methods if m.recipe_user_id == session.get_recipe_user_id()), None
    )
    if active is None:
        reject(503, "account_identity_unavailable")
    kinds = set()
    for method in methods:
        if method.recipe_id == "emailpassword":
            kinds.add("password")
        elif (
            method.recipe_id == "thirdparty"
            and method.third_party
            and method.third_party.id == "google"
        ):
            kinds.add("google")
    return {
        "email": active.email,
        "sign_in_methods": sorted(kinds),
        "can_change_password": password_credential(methods) is not None,
    }


async def change_password(session, current, new):
    from supertokens_python.recipe.emailpassword.asyncio import (
        update_email_or_password,
        verify_credentials,
    )
    from supertokens_python.recipe.emailpassword.interfaces import (
        SignInOkResult,
        UpdateEmailOrPasswordOkResult,
    )
    from supertokens_python.recipe.session.asyncio import revoke_all_sessions_for_user

    user, methods = await credentials(session)
    method = password_credential(methods)
    if method is None or not method.email:
        reject(403, "password_change_unavailable")
    verified = await provider_call(
        verify_credentials(session.get_tenant_id(), method.email, current)
    )
    if (
        not isinstance(verified, SignInOkResult)
        or verified.user.id != user.id
        or verified.recipe_user_id != method.recipe_user_id
    ):
        reject(400, "current_password_incorrect")
    result = await provider_call(
        update_email_or_password(
            method.recipe_user_id,
            password=new,
            apply_password_policy=True,
            tenant_id_for_password_policy=session.get_tenant_id(),
        )
    )
    if not isinstance(result, UpdateEmailOrPasswordOkResult):
        reject(422, "password_change_rejected")
    # Same policy as password reset: reauthenticate on every device afterward.
    await provider_call(revoke_all_sessions_for_user(user.id))
    await provider_call(session.revoke_session())
