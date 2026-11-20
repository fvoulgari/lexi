from fastapi.testclient import TestClient

from app.main import create_app


def csrf(client):
    return {"X-CSRF-Token": client.get("/api/auth/session").json()["csrf_token"]}


def test_logout_requires_csrf_and_revokes_verified_session(logged_in):
    client = logged_in
    headers = csrf(client)
    assert client.post("/api/auth/logout").status_code == 403
    assert client.get("/api/vocabulary").status_code == 200
    cookie = client.cookies.get("test_verified_session")
    assert client.post("/api/auth/logout", headers=headers).status_code == 200
    client.cookies.set("test_verified_session", cookie)
    assert client.get("/api/vocabulary").status_code == 401


def test_password_endpoint_is_removed_and_cross_origin_logout_rejected(logged_in):
    assert (
        logged_in.post("/api/auth/login", json={"password": "wrong"}).status_code == 405
    )
    assert (
        logged_in.post(
            "/api/auth/logout",
            headers={**csrf(logged_in), "Origin": "https://another-site.example"},
        ).status_code
        == 403
    )


def test_throttling_survives_application_restart(client):
    from app.auth import AuthGate
    from app.config import Settings
    from app.database import database

    engine, sessions = database(Settings().database_url)
    gate = AuthGate(Settings(), sessions)
    for _ in range(5):
        assert gate.throttle("restart-test")
    restarted = AuthGate(Settings(), sessions)
    assert not restarted.throttle("restart-test")
    engine.dispose()


def test_verified_provider_session_survives_application_restart(logged_in):
    cookie = logged_in.cookies.get("test_verified_session")
    with TestClient(create_app()) as restarted:
        restarted.cookies.set("test_verified_session", cookie)
        assert restarted.get("/api/vocabulary").status_code == 200


def test_forged_session_and_csrf_tokens_do_not_open_gate(client):
    from conftest import signin

    client.cookies.set("test_verified_session", "forged-token")
    assert client.get("/api/vocabulary").status_code == 401
    signin(client)
    assert (
        client.post("/api/auth/logout", headers={"X-CSRF-Token": "forged"}).status_code
        == 403
    )
    assert client.get("/api/vocabulary").status_code == 200


def test_public_pwa_files_and_private_api_cache_policy(client, tmp_path, monkeypatch):
    files = {
        "sw.js": ("self.addEventListener('fetch', () => {});", "text/javascript"),
        "manifest.webmanifest": (
            '{"display":"standalone"}',
            "application/manifest+json",
        ),
        "icon-192.png": ("public icon", "image/png"),
        "icon-512.png": ("public icon", "image/png"),
        "apple-touch-icon.png": ("public icon", "image/png"),
    }
    for name, (body, _) in files.items():
        (tmp_path / name).write_text(body)
    (tmp_path / "index.html").write_text("<html>public shell</html>")
    monkeypatch.setenv("STATIC_DIR", str(tmp_path))
    with TestClient(create_app()) as app:
        for name, (body, media_type) in files.items():
            response = app.get("/" + name)
            assert response.status_code == 200
            assert response.text == body
            assert response.headers["content-type"].startswith(media_type)
            assert response.headers["cache-control"] == "no-store"
        assert app.get("/api/vocabulary").status_code == 401
        assert app.get("/api/vocabulary").headers["cache-control"] == "no-store"
        assert "public shell" in app.get("/practice").text
        (tmp_path / "sw.js").unlink()
        assert app.get("/sw.js").status_code == 404
