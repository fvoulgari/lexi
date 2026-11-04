"""Maintained provider recipes without application token parsing."""

from urllib.parse import urlsplit


def configure_provider(app, settings):
    from supertokens_python import InputAppInfo, SupertokensConfig, init
    from supertokens_python.framework.fastapi import get_middleware
    from supertokens_python.ingredients.emaildelivery.types import (
        EmailDeliveryConfig,
    )
    from supertokens_python.recipe import (
        accountlinking,
        emailpassword,
        emailverification,
        session,
        thirdparty,
    )
    from supertokens_python.recipe.accountlinking.types import (
        ShouldNotAutomaticallyLink,
    )
    from supertokens_python.recipe.emailpassword import (
        EmailPasswordOverrideConfig,
        InputFormField,
        InputSignUpFeature,
    )
    from supertokens_python.recipe.thirdparty import SignInAndUpFeature
    from supertokens_python.recipe.thirdparty.provider import (
        ProviderClientConfig,
        ProviderConfig,
        ProviderInput,
    )
    from supertokens_python.recipe.thirdparty.utils import ThirdPartyOverrideConfig

    from app.auth_email import AuthEmailDelivery

    async def never_link(*_args):
        return ShouldNotAutomaticallyLink()

    def cookie_only(_request, _creating, _context):
        return "cookie"

    def trusted_callback(uri, _request, _context):
        return uri == settings.public_origin.rstrip("/") + "/auth/callback/google"

    init(
        app_info=InputAppInfo(
            app_name="Lexi",
            api_domain=settings.public_origin,
            website_domain=settings.public_origin,
            api_base_path="/api/auth",
            website_base_path="/auth",
        ),
        supertokens_config=SupertokensConfig(
            connection_uri=settings.supertokens_connection_uri,
            api_key=settings.supertokens_api_key.get_secret_value(),
        ),
        framework="fastapi",
        mode="asgi",
        recipe_list=[
            session.init(
                cookie_secure=settings.cookie_secure,
                cookie_same_site="lax",
                anti_csrf="VIA_CUSTOM_HEADER",
                get_token_transfer_method=cookie_only,
                expose_access_token_to_frontend_in_cookie_based_auth=False,
            ),
            accountlinking.init(should_do_automatic_account_linking=never_link),
            thirdparty.init(
                sign_in_and_up_feature=SignInAndUpFeature(
                    providers=[
                        ProviderInput(
                            config=ProviderConfig(
                                third_party_id="google",
                                clients=[
                                    ProviderClientConfig(
                                        client_id=settings.google_client_id,
                                        client_secret=settings.google_client_secret.get_secret_value(),
                                        scope=["openid", "email", "profile"],
                                        force_pkce=True,
                                    ),
                                ],
                            )
                        ),
                    ]
                ),
                is_valid_frontend_redirect_uri=trusted_callback,
                override=ThirdPartyOverrideConfig(
                    apis=lambda apis: restrict_thirdparty(apis, settings.public_origin)
                ),
            ),
            emailpassword.init(
                sign_up_feature=InputSignUpFeature(
                    form_fields=[
                        InputFormField(id="password", validate=validate_password),
                    ]
                ),
                override=EmailPasswordOverrideConfig(apis=restrict_emailpassword),
                email_delivery=EmailDeliveryConfig(service=AuthEmailDelivery(settings)),
            ),
            emailverification.init(
                mode="REQUIRED",
                email_delivery=EmailDeliveryConfig(service=AuthEmailDelivery(settings)),
            ),
        ],
    )
    app.add_middleware(get_middleware())


def configuration_ready(settings):
    required = (
        settings.supertokens_connection_uri,
        settings.supertokens_api_key.get_secret_value(),
        settings.google_client_id,
        settings.google_client_secret.get_secret_value(),
        settings.resend_api_key.get_secret_value(),
        settings.email_from,
    )
    if not all(required):
        return False
    core = urlsplit(settings.supertokens_connection_uri)
    origin = urlsplit(settings.public_origin)
    if settings.cookie_secure:
        return core.scheme == "https" and origin.scheme == "https"
    return (
        core.scheme in {"http", "https"}
        and origin.scheme == "http"
        and origin.hostname in {"localhost", "127.0.0.1", "::1"}
    )


def reject_linking(arguments):
    from supertokens_python.exceptions import raise_bad_input_exception

    if arguments.get("should_try_linking_with_session_user"):
        raise_bad_input_exception("Account linking is not enabled.")


def restrict_thirdparty(apis, public_origin):
    """Limit web OAuth to our one callback; native token login is not exposed."""
    from supertokens_python.exceptions import raise_bad_input_exception

    original_url = apis.authorisation_url_get
    original_signin = apis.sign_in_up_post
    callback = public_origin.rstrip("/") + "/auth/callback/google"

    async def authorisation_url_get(**arguments):
        if arguments["redirect_uri_on_provider_dashboard"] != callback:
            raise_bad_input_exception("Untrusted authentication callback.")
        return await original_url(**arguments)

    async def sign_in_up_post(**arguments):
        reject_linking(arguments)
        redirect = arguments.get("redirect_uri_info")
        if arguments.get("oauth_tokens") is not None or redirect is None:
            raise_bad_input_exception("Use the Google web sign-in flow.")
        if redirect.redirect_uri_on_provider_dashboard != callback:
            raise_bad_input_exception("Untrusted authentication callback.")
        return await original_signin(**arguments)

    apis.authorisation_url_get = authorisation_url_get
    apis.sign_in_up_post = sign_in_up_post
    return apis


async def validate_password(value, _tenant_id):
    # One policy is shared by SDK registration and reset validation. Allow paste,
    # spaces, Unicode and password managers; avoid arbitrary composition rules.
    if not isinstance(value, str) or not 15 <= len(value) <= 128:
        return "Use between 15 and 128 characters."
    return None


def restrict_emailpassword(apis):
    from supertokens_python.recipe.emailpassword.interfaces import (
        GeneratePasswordResetTokenPostOkResult,
        SignInPostOkResult,
        SignUpOkResult,
        WrongCredentialsError,
    )
    from supertokens_python.recipe.emailverification.asyncio import (
        send_email_verification_email,
    )

    apis.disable_email_exists_get = True
    original_signin = apis.sign_in_post
    original_recovery = apis.generate_password_reset_token_post
    original_reset = apis.password_reset_post

    async def sign_up_post(
        form_fields,
        tenant_id,
        session,
        should_try_linking_with_session_user,
        api_options,
        user_context,
    ):
        arguments = locals()
        reject_linking(arguments)
        fields = {f.id: f.value for f in arguments["form_fields"]}
        from supertokens_python.auth_utils import is_fake_email

        if is_fake_email(fields["email"]):
            return GeneratePasswordResetTokenPostOkResult()
        # Use the provider's password handling without creating a session or
        # exposing a new/duplicate account distinction through response/cookies.
        result = await arguments["api_options"].recipe_implementation.sign_up(
            email=fields["email"],
            password=fields["password"],
            tenant_id=arguments["tenant_id"],
            session=None,
            should_try_linking_with_session_user=False,
            user_context=arguments["user_context"],
        )
        if isinstance(result, SignUpOkResult):
            from app.auth_email import EmailDeliveryUnavailable

            try:
                await send_email_verification_email(
                    arguments["tenant_id"],
                    result.user.id,
                    result.recipe_user_id,
                    fields["email"],
                    arguments["user_context"],
                )
            except EmailDeliveryUnavailable:
                pass  # Same public registration response during delivery outages.
        return GeneratePasswordResetTokenPostOkResult()

    async def sign_in_post(*args, **arguments):
        if args:
            arguments = (
                dict(
                    zip(
                        (
                            "form_fields",
                            "tenant_id",
                            "session",
                            "should_try_linking_with_session_user",
                            "api_options",
                            "user_context",
                        ),
                        args,
                    )
                )
                | arguments
            )
        reject_linking(arguments)
        result = await original_signin(**arguments)
        return (
            result
            if isinstance(result, SignInPostOkResult)
            else WrongCredentialsError()
        )

    async def generate_password_reset_token_post(*args, **arguments):
        if args:
            arguments = (
                dict(
                    zip(
                        ("form_fields", "tenant_id", "api_options", "user_context"),
                        args,
                    )
                )
                | arguments
            )
        # The SDK only resets the email/password identity when linking is off.
        from app.auth_email import EmailDeliveryUnavailable

        try:
            await original_recovery(**arguments)
        except EmailDeliveryUnavailable:
            pass  # Avoid distinguishing a known recipient during an outage.
        return GeneratePasswordResetTokenPostOkResult()

    async def password_reset_post(*args, **arguments):
        result = await original_reset(*args, **arguments)
        if result.status == "OK":
            from supertokens_python.recipe.session.asyncio import (
                revoke_all_sessions_for_user,
            )

            await revoke_all_sessions_for_user(result.user.id)
        return result

    apis.sign_up_post = sign_up_post
    apis.sign_in_post = sign_in_post
    apis.generate_password_reset_token_post = generate_password_reset_token_post
    apis.password_reset_post = password_reset_post
    return apis
