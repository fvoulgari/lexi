"""Exercise real PostgreSQL throttles with the installed Uvicorn trust middleware.

Trusted proxy addresses below are synthetic fixtures, not Railway allowlists.
These tests do not establish Railway ingress provenance.
"""

from datetime import UTC, datetime, timedelta

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import update
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware

from app.auth import initialize_auth
from app.config import Settings
from app.models import LoginThrottle


def boundary(sessions):
    app = FastAPI()
    gate = initialize_auth(
        app,
        Settings(_env_file=None, login_limit=2),
        sessions,
    )
    # Avoid provider/network calls: only the real HTTP boundary and DB limiter
    # are under test. An allowed request reaches the inert test endpoint.
    gate.ready = True

    @app.post("/api/auth/signin")
    def signin():
        return {"accepted_by_boundary": True}

    return ProxyHeadersMiddleware(app, trusted_hosts=["192.0.2.10"])


def test_untrusted_peer_cannot_rotate_throttle_with_forwarded_headers(client):
    app = boundary(client.app.state.sessions)
    with TestClient(app, client=("198.51.100.7", 1234)) as caller:
        for index, status in enumerate((200, 200, 429, 429)):
            response = caller.post(
                "/api/auth/signin",
                headers={
                    "X-Forwarded-For": f"203.0.113.{index + 1}",
                    "X-Real-IP": f"203.0.113.{index + 10}",
                    "Forwarded": f"for=203.0.113.{index + 20}",
                    "CF-Connecting-IP": f"203.0.113.{index + 30}",
                    "Host": "staging.lexi.fotiniv.com",
                },
            )
            assert response.status_code == status
        assert response.headers["Retry-After"] == "60"
    with TestClient(app, client=("198.51.100.8", 1234)) as other:
        assert other.post("/api/auth/signin").status_code == 200


def test_explicit_trusted_proxy_distinguishes_clients_and_window_resets(client):
    app = boundary(client.app.state.sessions)
    with TestClient(app, client=("192.0.2.10", 1234)) as proxy:
        a = {"X-Forwarded-For": "198.51.100.7"}
        b = {"X-Forwarded-For": "198.51.100.8"}
        assert [
            proxy.post("/api/auth/signin", headers=a).status_code for _ in range(3)
        ] == [
            200,
            200,
            429,
        ]
        assert proxy.post("/api/auth/signin", headers=b).status_code == 200
        with client.app.state.sessions.begin() as db:
            db.execute(
                update(LoginThrottle).values(
                    window_start=datetime.now(UTC) - timedelta(seconds=61)
                )
            )
        assert proxy.post("/api/auth/signin", headers=a).status_code == 200


def test_shared_untrusted_proxy_collapses_distinct_forwarded_clients(client):
    app = boundary(client.app.state.sessions)
    # Reproduce the deployment hazard: the same untrusted transport peer means
    # different forwarded clients still share one rate bucket.
    with TestClient(app, client=("192.0.2.11", 1234)) as proxy:
        statuses = [
            proxy.post(
                "/api/auth/signin", headers={"X-Forwarded-For": f"198.51.100.{i}"}
            ).status_code
            for i in range(1, 4)
        ]
    assert statuses == [200, 200, 429]
