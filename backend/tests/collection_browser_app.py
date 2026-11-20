"""Local browser-only fixture. Never import from production or expose off loopback."""

import os
from urllib.parse import urlparse

from fastapi import HTTPException, Request

from app.auth import AuthGate
from app.main import create_app


def factory():
    url = urlparse(os.environ.get("DATABASE_URL", ""))
    if (
        os.environ.get("LEXI_COLLECTION_BROWSER_TEST") != "1"
        or url.hostname != "127.0.0.1"
        or not url.path.endswith("_test")
    ):
        raise RuntimeError("Requires explicit local disposable test database.")

    class SyntheticSession:
        def __init__(self, subject):
            self.subject = subject

        def get_user_id(self):
            return self.subject

    async def session(self, request, required=True):
        subject = request.cookies.get("collection_test_user")
        if not subject and required:
            raise HTTPException(401, "Synthetic session required.")
        return SyntheticSession(subject) if subject else None

    async def verified(self, session):
        return True

    async def csrf(self, request: Request):
        if request.headers.get("X-CSRF-Token") != "supertokens":
            raise HTTPException(403, "CSRF required.")
        await self.require(request)

    AuthGate._session = session
    AuthGate._verified = verified
    AuthGate.check_csrf = csrf
    app = create_app()
    app.state.gate.ready = True
    return app
