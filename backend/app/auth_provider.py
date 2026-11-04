"""Maintained provider recipes without application token parsing."""

from urllib.parse import urlsplit


def configure_provider(app, settings):
    from supertokens_python import InputAppInfo, SupertokensConfig, init
    from supertokens_python.framework.fastapi import get_middleware
    from supertokens_python.ingredients.emaildelivery.types import (
        EmailDeliveryConfig,
        SMTPSettings,
        SMTPSettingsFrom,
    )
    from supertokens_python.recipe import (
        accountlinking,
        passwordless,
        session,
        thirdparty,
    )
    from supertokens_python.recipe.accountlinking.types import (
        ShouldNotAutomaticallyLink,
    )
    from supertokens_python.recipe.passwordless import ContactEmailOnlyConfig
    from supertokens_python.recipe.passwordless.emaildelivery.services.smtp import (
        SMTPService,
    )
    from supertokens_python.recipe.passwordless.utils import PasswordlessOverrideConfig
    from supertokens_python.recipe.thirdparty import SignInAndUpFeature
    from supertokens_python.recipe.thirdparty.provider import (
        ProviderClientConfig,
        ProviderConfig,
        ProviderInput,
    )
    from supertokens_python.recipe.thirdparty.utils import ThirdPartyOverrideConfig

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
            passwordless.init(
                override=PasswordlessOverrideConfig(apis=restrict_passwordless),
                flow_type="MAGIC_LINK",
                contact_config=ContactEmailOnlyConfig(),
                email_delivery=EmailDeliveryConfig(
                    service=SMTPService(
                        SMTPSettings(
                            host=settings.smtp_host,
                            port=settings.smtp_port,
                            from_=SMTPSettingsFrom(
                                name="Lexi", email=settings.smtp_from_email
                            ),
                            username=settings.smtp_username or None,
                            password=settings.smtp_password.get_secret_value() or None,
                            secure=settings.smtp_secure,
                        )
                    )
                ),
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
        settings.smtp_host,
        settings.smtp_from_email,
    )
    if not all(required):
        return False
    core = urlsplit(settings.supertokens_connection_uri)
    origin = urlsplit(settings.public_origin)
    if settings.cookie_secure:
        return (
            core.scheme == "https" and origin.scheme == "https" and settings.smtp_secure
        )
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


def restrict_passwordless(apis):
    # The standard recipe exposes unauthenticated email/phone existence APIs.
    # Neutral UI copy alone would not protect account existence.
    apis.disable_email_exists_get = True
    apis.disable_phone_number_exists_get = True
    original_consume = apis.consume_code_post

    async def consume_code_post(**arguments):
        reject_linking(arguments)
        return await original_consume(**arguments)

    apis.consume_code_post = consume_code_post
    return apis
