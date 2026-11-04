import os
import secrets
from pathlib import Path
from urllib.parse import urlparse

import pytest
from alembic.config import Config
from fastapi import HTTPException, Request
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, delete, select
from sqlalchemy.orm import Session

from alembic import command
from app.auth import AuthGate
from app.main import create_app
from app.models import Account, Base, Profile
from app.seed import seed

TEST_CSRF = "supertokens"
TEST_SESSIONS = {}


def signin(client, subject="test-admin"):
    token = secrets.token_urlsafe(24)
    TEST_SESSIONS[token] = subject
    client.cookies.set("test_verified_session", token)
    return client


@pytest.fixture(scope="session", autouse=True)
def test_database(tmp_path_factory):
    url = os.environ.get(
        "TEST_DATABASE_URL",
        "postgresql+psycopg://postgres:lexi-test-only@127.0.0.1:55432/lexi_test",
    )
    if not urlparse(url).path.endswith("_test"):
        pytest.fail("TEST_DATABASE_URL must name a disposable database ending in _test")
    os.environ.update(
        DATABASE_URL=url, COOKIE_SECURE="false", PUBLIC_ORIGIN="http://testserver"
    )
    static = tmp_path_factory.mktemp("static")
    (static / "index.html").write_text('<html><div id="root"></div></html>')
    os.environ["STATIC_DIR"] = str(static)
    command.upgrade(Config(str(Path(__file__).parents[1] / "alembic.ini")), "head")
    return url


@pytest.fixture
def client(test_database, monkeypatch):
    engine = create_engine(test_database)
    with engine.begin() as connection:
        for table in reversed(Base.metadata.sorted_tables):
            connection.execute(delete(table))
    seed()
    with Session(engine) as db:
        profiles = list(db.scalars(select(Profile).order_by(Profile.display_name)))
        admin = Account(
            provider_subject="test-admin",
            profile_id=profiles[0].id,
            role="admin",
            legacy_access=True,
        )
        db.add(admin)
        db.commit()
    TEST_SESSIONS.clear()

    class VerifiedSession:
        def __init__(self, token, subject):
            self.token, self.subject = token, subject

        def get_user_id(self):
            return self.subject

        async def revoke_session(self):
            TEST_SESSIONS.pop(self.token, None)

    async def verified_session(self, request, required=True):
        token = request.cookies.get("test_verified_session")
        subject = TEST_SESSIONS.get(token)
        if subject:
            return VerifiedSession(token, subject)
        if required:
            raise HTTPException(
                401, {"code": "authentication_required", "message": "Sign in first."}
            )
        return None

    async def csrf(self, request: Request):
        if (
            request.headers.get("X-CSRF-Token") != TEST_CSRF
            or request.headers.get("sec-fetch-site") == "cross-site"
            or request.headers.get("origin", "http://testserver") != "http://testserver"
        ):
            raise HTTPException(403, "CSRF token required.")
        await self.require(request)

    monkeypatch.setattr(AuthGate, "_session", verified_session)
    monkeypatch.setattr(AuthGate, "check_csrf", csrf)
    app = create_app()
    app.state.auth_gate.ready = True
    with TestClient(app) as test_client:
        yield test_client
    engine.dispose()


@pytest.fixture
def logged_in(client):
    return signin(client)


@pytest.fixture
def account_client(client):
    """Sign this client into a distinct verified identity; returns its account JSON."""

    def switch(subject="test-learner", role=None, legacy_access=False):
        signin(client, subject)
        account = client.get("/api/auth/session").json()["account"]
        if role is not None or legacy_access:
            engine = create_engine(os.environ["DATABASE_URL"])
            with Session(engine) as db:
                row = db.get(Account, __import__("uuid").UUID(account["id"]))
                row.role = role or row.role
                row.legacy_access = legacy_access
                db.commit()
            engine.dispose()
            account = client.get("/api/auth/session").json()["account"]
        return account

    return switch
