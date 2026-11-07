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
        Settings(
            _env_file=None,
            login_limit=2,
            public_origin="https://staging.lexi.fotiniv.com",
        ),
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


def test_unknown_ingress_does_not_gain_trust_from_headers(client):
    app = boundary(client.app.state.sessions)
    # A non-IP/unknown test transport is never promoted to a claimed visitor IP.
    with TestClient(app, client=("unknown-ingress", 0)) as caller:
        statuses = [
            caller.post(
                "/api/auth/public/signin/",
                headers={
                    "X-Real-IP": f"198.51.100.{i}",
                    "X-Forwarded-For": f"198.51.100.{i}",
                    "Host": "staging.lexi.fotiniv.com",
                    "Origin": "https://staging.lexi.fotiniv.com",
                },
            ).status_code
            for i in range(1, 4)
        ]
    # Alias has no test endpoint, but allowed attempts reach routing (404),
    # whereas the third request is rejected before routing/provider execution.
    assert statuses == [404, 404, 429]


def test_real_sdk_invalid_google_initiation_is_throttled_before_validation(client):
    app = FastAPI()
    initialize_auth(
        app,
        Settings(
            _env_file=None,
            database_url="postgresql://test:test@localhost/test",
            public_origin="https://staging.lexi.fotiniv.com",
            cookie_secure=True,
            supertokens_connection_uri="https://core.example.invalid",
            supertokens_api_key="local-test-not-live",
            google_client_id="local-test-not-live",
            google_client_secret="local-test-not-live",
            resend_api_key="local-test-not-live",
            email_from="test@example.invalid",
            login_limit=2,
        ),
        client.app.state.sessions,
    )
    # Same inert route as the hosted probe, with actual provider middleware.
    # Validation fails before any Core/Google call, but must still spend allowance.
    with TestClient(app, base_url="https://staging.lexi.fotiniv.com") as caller:
        statuses = [
            caller.get("/api/auth/authorisationurl").status_code for _ in range(3)
        ]
    assert statuses == [400, 400, 429]
