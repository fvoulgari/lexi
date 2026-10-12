import os
from pathlib import Path
from urllib.parse import urlparse

import pytest
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, delete

from alembic import command
from app.main import create_app
from app.models import (
    GateSession,
    LearningProgress,
    LoginThrottle,
    PracticeSession,
    ReviewEvent,
    SessionCard,
    Tag,
    Unit,
    VocabularyEntry,
)
from app.seed import seed


@pytest.fixture(scope="session", autouse=True)
def test_database(tmp_path_factory):
    url = os.environ.get(
        "TEST_DATABASE_URL",
        "postgresql+psycopg://postgres:lexi-test-only@127.0.0.1:55432/lexi_test",
    )
    if not urlparse(url).path.endswith("_test"):
        pytest.fail("TEST_DATABASE_URL must name a disposable database ending in _test")
    os.environ.update(
        DATABASE_URL=url,
        SHARED_PASSWORD="test-notebook-password",
        SESSION_SECRET="test-session-secret-at-least-32-characters",
        COOKIE_SECURE="false",
        PUBLIC_ORIGIN="http://testserver",
    )
    static = tmp_path_factory.mktemp("static")
    (static / "index.html").write_text('<html><div id="root"></div></html>')
    os.environ["STATIC_DIR"] = str(static)
    command.upgrade(Config(str(Path(__file__).parents[1] / "alembic.ini")), "head")
    seed()
    return url


@pytest.fixture
def client(test_database):
    engine = create_engine(test_database)
    with engine.begin() as connection:
        for model in (LearningProgress, ReviewEvent, SessionCard, PracticeSession):
            connection.execute(delete(model))
        connection.execute(delete(VocabularyEntry))
        connection.execute(delete(Tag))
        connection.execute(delete(Unit))
        connection.execute(delete(GateSession))
        connection.execute(delete(LoginThrottle))
    engine.dispose()
    seed()
    with TestClient(create_app()) as client:
        yield client


@pytest.fixture
def logged_in(client):
    csrf = client.get("/api/auth/session").json()["csrf_token"]
    assert (
        client.post(
            "/api/auth/login",
            json={"password": "test-notebook-password"},
            headers={"X-CSRF-Token": csrf},
        ).status_code
        == 200
    )
    return client
