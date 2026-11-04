"""HTTPS-only transactional delivery for provider-owned verification/reset tokens."""

import logging
from urllib.parse import urlsplit

import httpx
from supertokens_python.ingredients.emaildelivery.types import EmailDeliveryInterface

log = logging.getLogger("lexi.security")


class EmailDeliveryUnavailable(RuntimeError):
    pass


class AuthEmailDelivery(EmailDeliveryInterface):
    def __init__(self, settings):
        self.settings = settings

    async def send_email(self, template_vars, user_context):
        verification = hasattr(template_vars, "email_verify_link")
        link = (
            template_vars.email_verify_link
            if verification
            else template_vars.password_reset_link
        )
        # Tokens are generated and consumed exclusively by SuperTokens.
        expected = urlsplit(self.settings.public_origin)
        actual = urlsplit(link)
        if (actual.scheme, actual.netloc) != (expected.scheme, expected.netloc):
            raise ValueError("Untrusted authentication email origin")
        subject = (
            "Verify your Lexi email" if verification else "Reset your Lexi password"
        )
        action = "verify your email" if verification else "reset your password"
        try:
            async with httpx.AsyncClient(timeout=10, follow_redirects=False) as client:
                response = await client.post(
                    "https://api.resend.com/emails",
                    headers={
                        "Authorization": "Bearer "
                        + self.settings.resend_api_key.get_secret_value()
                    },
                    json={
                        "from": self.settings.email_from,
                        "to": [template_vars.user.email],
                        "subject": subject,
                        "text": f"Open this link to {action}:\n\n{link}\n\n"
                        "If you did not request this, ignore this email.",
                    },
                )
                if response.status_code not in {200, 201, 202}:
                    raise EmailDeliveryUnavailable("Email delivery unavailable")
        except Exception:
            # Never propagate provider response bodies, recipient, tokens or API key.
            log.warning("authentication_email_delivery_failed")
            raise EmailDeliveryUnavailable("Email delivery unavailable") from None
