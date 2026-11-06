import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.auth import initialize_auth
from app.config import Settings
from app.ingress import tunnel_client_ip


def scope(headers, peer="127.0.0.1"):
    return {"client": (peer, 1234), "headers": headers}


@pytest.mark.parametrize(
    "values",
    [
        [],
        [b""],
        [b"bad"],
        [b"0.0.0.0"],
        [b"::"],
        [b"224.0.0.1"],
        [b"fe80::1%eth0"],
        [b" 198.51.100.1"],
        [b"198.51.100.1,198.51.100.2"],
        [b"198.51.100.1", b"198.51.100.1"],
    ],
)
def test_invalid_identity_has_no_header_fallback(values):
    headers = [(b"cf-connecting-ip", value) for value in values]
    headers += [(b"x-real-ip", b"198.51.100.1"), (b"x-forwarded-for", b"198.51.100.1")]
    with pytest.raises(ValueError, match="invalid_client_ip"):
        tunnel_client_ip(scope(headers))


def test_nonloopback_peer_cannot_claim_tunnel_identity():
    with pytest.raises(ValueError, match="untrusted_ingress"):
        tunnel_client_ip(scope([(b"cf-connecting-ip", b"198.51.100.1")], "10.0.0.1"))
    assert (
        tunnel_client_ip(scope([(b"cf-connecting-ip", b"::ffff:198.51.100.1")]))
        == "198.51.100.1"
    )


def test_tunnel_identity_drives_real_database_limit(client):
    app = FastAPI()
    gate = initialize_auth(
        app,
        Settings(
            _env_file=None,
            auth_ingress_mode="cloudflare_tunnel",
            login_limit=5,
            public_origin="https://staging.lexi.fotiniv.com",
        ),
        client.app.state.sessions,
    )
    gate.ready = True

    @app.get("/api/auth/authorisationurl")
    def inert():
        return {"ok": True}

    with TestClient(app, client=("127.0.0.1", 1234)) as caller:
        for index in range(6):
            response = caller.get(
                "/api/auth/authorisationurl",
                headers={
                    "CF-Connecting-IP": "198.51.100.1",
                    "X-Real-IP": f"203.0.113.{index}",
                    "X-Forwarded-For": f"203.0.113.{index}",
                },
            )
            assert response.status_code == (200 if index < 5 else 429)
        assert (
            caller.get(
                "/api/auth/authorisationurl",
                headers={"CF-Connecting-IP": "198.51.100.2"},
            ).status_code
            == 200
        )
        assert caller.get("/api/auth/authorisationurl").status_code == 400
        assert (
            caller.get(
                "/api/auth/authorisationurl",
                headers=[
                    ("CF-Connecting-IP", "198.51.100.2"),
                    ("CF-Connecting-IP", "198.51.100.2"),
                ],
            ).status_code
            == 400
        )
    with TestClient(app, client=("10.0.0.1", 1234)) as bypass:
        assert (
            bypass.get(
                "/api/auth/authorisationurl",
                headers={"CF-Connecting-IP": "198.51.100.2"},
            ).status_code
            == 403
        )


@pytest.mark.parametrize(
    "path",
    [
        "/api/auth/signin",
        "/api/auth/signup",
        "/api/auth/user/password/reset/token",
        "/api/auth/user/password/reset",
    ],
)
@pytest.mark.parametrize("alias", [False, True])
def test_password_routes_and_public_aliases_use_tunnel_limit(client, path, alias):
    app = FastAPI()
    gate = initialize_auth(
        app,
        Settings(_env_file=None, auth_ingress_mode="cloudflare_tunnel", login_limit=5),
        client.app.state.sessions,
    )
    gate.ready = True
    route = path.replace("/api/auth/", "/api/auth/public/", 1) if alias else path

    @app.post(route)
    def inert():
        return {"ok": True}

    with TestClient(app, client=("127.0.0.1", 1234)) as caller:
        assert [
            caller.post(
                route, headers={"CF-Connecting-IP": "198.51.100.80"}, json={}
            ).status_code
            for _ in range(6)
        ] == [200] * 5 + [429]
