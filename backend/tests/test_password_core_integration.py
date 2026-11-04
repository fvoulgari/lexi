"""Opt-in real local Core test; email transport is captured, never delivered.

Run with LEXI_TEST_CORE_URI=http://127.0.0.1:13567 and an isolated Core.
Only loopback Core is accepted. The ordinary disposable test DB is used.
"""

import asyncio
import os
import time
from urllib.parse import parse_qs, urlsplit
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from supertokens_python.supertokens import Supertokens

from app.auth_email import AuthEmailDelivery
from app.main import create_app


@pytest.mark.skipif(
    not os.environ.get("LEXI_TEST_CORE_URI"), reason="isolated local Core not requested"
)
def test_real_core_password_verification_reset_and_sessions(test_database, monkeypatch):
    uri = os.environ["LEXI_TEST_CORE_URI"]
    assert urlsplit(uri).hostname in {"localhost", "127.0.0.1", "::1"}
    monkeypatch.setenv("SUPERTOKENS_ENV", "testing")
    Supertokens.reset()
    for key, value in {
        "SUPERTOKENS_CONNECTION_URI": uri,
        "SUPERTOKENS_API_KEY": os.environ.get(
            "LEXI_TEST_CORE_KEY", "local-disposable-core-test-key"
        ),
        "GOOGLE_CLIENT_ID": "local-test-not-live",
        "GOOGLE_CLIENT_SECRET": "local-test-not-live",
        "RESEND_API_KEY": "local-test-not-live",
        "EMAIL_FROM": "test@example.invalid",
        "PUBLIC_ORIGIN": "http://localhost",
        "COOKIE_SECURE": "false",
        "LOGIN_LIMIT": "100",
    }.items():
        monkeypatch.setenv(key, value)
    emails = []

    async def capture(self, template_vars, user_context):
        emails.append(template_vars)

    monkeypatch.setattr(AuthEmailDelivery, "send_email", capture)
    headers = {"rid": "emailpassword", "Origin": "http://localhost"}
    email = f"synthetic-{uuid4()}@example.invalid"
    password = "a long synthetic password"
    app = create_app()

    def fields(password_value=password, email_value=email):
        return {
            "formFields": [
                {"id": "email", "value": email_value},
                {"id": "password", "value": password_value},
            ],
            "shouldTryLinkingWithSessionUser": False,
        }

    def token(template, attr):
        return parse_qs(urlsplit(getattr(template, attr)).query)["token"][0]

    try:
        with (
            TestClient(app, base_url="http://localhost") as a,
            TestClient(app, base_url="http://localhost") as b,
        ):
            a.headers.update(headers)
            b.headers.update(headers)
            assert (
                a.post("/api/auth/signup", json=fields("short")).json()["status"]
                == "FIELD_ERROR"
            )
            created = a.post("/api/auth/signup", json=fields())
            assert created.json() == {"status": "OK"}
            assert "set-cookie" not in created.headers
            duplicate = a.post("/api/auth/signup", json=fields())
            assert duplicate.json() == created.json()
            assert "set-cookie" not in duplicate.headers
            assert len(emails) == 1
            # Verification links work without a pre-existing login session.
            verification = token(emails[-1], "email_verify_link")
            assert a.post("/api/auth/signin", json=fields()).json()["status"] == "OK"
            assert a.get("/api/auth/session").json()["verification_required"] is True
            assert a.get("/api/vocabulary").status_code == 403
            assert a.get("/api/legacy-claims/preview").status_code == 403
            verified = b.post(
                "/api/auth/user/email/verify", json={"token": verification}
            )
            assert verified.json()["status"] == "OK"
            assert (
                b.post(
                    "/api/auth/user/email/verify", json={"token": verification}
                ).json()["status"]
                == "EMAIL_VERIFICATION_INVALID_TOKEN_ERROR"
            )
            assert a.post("/api/auth/signin", json=fields()).json()["status"] == "OK"
            identity = a.get("/api/auth/session").json()
            assert identity["authenticated"] is True
            assert identity["account"]["role"] == "learner"
            assert b.post("/api/auth/signin", json=fields()).json()["status"] == "OK"
            assert (
                b.get("/api/auth/session").json()["account"]["id"]
                == identity["account"]["id"]
            )
            assert a.get("/api/vocabulary").status_code == 200
            # Provider-confirmed synthetic Google identity; this is not OAuth E2E.
            from supertokens_python.recipe.thirdparty.asyncio import (
                manually_create_or_update_user,
            )

            google = asyncio.run(
                manually_create_or_update_user(
                    "public", "google", str(uuid4()), email, True
                )
            )
            password_subject = a.post("/api/auth/signin", json=fields()).json()["user"][
                "id"
            ]
            assert google.user.id != password_subject
            google_only_email = f"google-only-{uuid4()}@example.invalid"
            google_only = asyncio.run(
                manually_create_or_update_user(
                    "public", "google", str(uuid4()), google_only_email, True
                )
            )
            count = len(emails)
            assert a.post(
                "/api/auth/user/password/reset/token",
                json={"formFields": [{"id": "email", "value": google_only_email}]},
            ).json() == {"status": "OK"}
            assert len(emails) == count
            assert (
                a.post(
                    "/api/auth/signin", json=fields(email_value=google_only_email)
                ).json()["status"]
                == "WRONG_CREDENTIALS_ERROR"
            )
            known = a.post(
                "/api/auth/user/password/reset/token",
                json={"formFields": [{"id": "email", "value": email}]},
            )
            reset = token(emails[-1], "password_reset_link")
            unknown = a.post(
                "/api/auth/user/password/reset/token",
                json={
                    "formFields": [
                        {"id": "email", "value": f"missing-{uuid4()}@example.invalid"}
                    ]
                },
            )
            assert known.json() == unknown.json() == {"status": "OK"}
            new_password = "a different synthetic password"
            body = {
                "token": reset,
                "formFields": [{"id": "password", "value": new_password}],
            }
            assert (
                a.post("/api/auth/user/password/reset", json=body).json()["status"]
                == "OK"
            )
            assert b.get("/api/auth/session").status_code == 401
            assert (
                a.post("/api/auth/user/password/reset", json=body).json()["status"]
                == "RESET_PASSWORD_INVALID_TOKEN_ERROR"
            )
            assert (
                a.post("/api/auth/signin", json=fields()).json()["status"]
                == "WRONG_CREDENTIALS_ERROR"
            )
            assert (
                a.post("/api/auth/signin", json=fields(new_password)).json()["status"]
                == "OK"
            )
            assert (
                a.get("/api/auth/session").json()["account"]["id"]
                == identity["account"]["id"]
            )
            # This disposable Core is configured with a two-second reset lifetime.
            a.post(
                "/api/auth/user/password/reset/token",
                json={"formFields": [{"id": "email", "value": email}]},
            )
            expired = token(emails[-1], "password_reset_link")
            time.sleep(2.2)
            body["token"] = expired
            assert (
                a.post("/api/auth/user/password/reset", json=body).json()["status"]
                == "RESET_PASSWORD_INVALID_TOKEN_ERROR"
            )
            from supertokens_python.asyncio import get_user

            google_after_reset = asyncio.run(get_user(google.user.id))
            assert all(
                method.recipe_id == "thirdparty"
                for method in google_after_reset.login_methods
            )
            assert all(
                method.recipe_id == "thirdparty"
                for method in asyncio.run(get_user(google_only.user.id)).login_methods
            )
            assert (
                a.post("/api/auth/signout", headers={"rid": "session"}).json()["status"]
                == "OK"
            )
            assert a.get("/api/auth/session").json()["authenticated"] is False
    finally:
        Supertokens.reset()
