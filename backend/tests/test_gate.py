from fastapi.testclient import TestClient

from app.main import create_app


def csrf(client):
    return {"X-CSRF-Token": client.get("/api/auth/session").json()["csrf_token"]}


def test_login_and_logout_require_csrf(client):
    assert (
        client.post(
            "/api/auth/login", json={"password": "test-notebook-password"}
        ).status_code
        == 403
    )
    headers = csrf(client)
    assert (
        client.post(
            "/api/auth/login",
            json={"password": "test-notebook-password"},
            headers=headers,
        ).status_code
        == 200
    )
    assert client.post("/api/auth/logout").status_code == 403
    assert client.get("/api/vocabulary").status_code == 200
    cookie = client.cookies.get("notebook_session")
    assert client.post("/api/auth/logout", headers=headers).status_code == 200
    client.cookies.set("notebook_session", cookie)
    assert client.get("/api/vocabulary").status_code == 401


def test_incorrect_password_and_cross_origin_login_are_rejected(client):
    headers = csrf(client)
    assert (
        client.post(
            "/api/auth/login", json={"password": "wrong"}, headers=headers
        ).status_code
        == 401
    )
    assert client.get("/api/vocabulary").status_code == 401
    headers["Origin"] = "https://another-site.example"
    assert (
        client.post(
            "/api/auth/login",
            json={"password": "test-notebook-password"},
            headers=headers,
        ).status_code
        == 403
    )


def test_throttling_survives_application_restart(client):
    headers = csrf(client)
    for _ in range(5):
        assert (
            client.post(
                "/api/auth/login", json={"password": "wrong"}, headers=headers
            ).status_code
            == 401
        )
    with TestClient(create_app()) as restarted:
        response = restarted.post(
            "/api/auth/login",
            json={"password": "test-notebook-password"},
            headers=csrf(restarted),
        )
        assert response.status_code == 429
        assert response.headers["Retry-After"] == "60"


def test_session_survives_restart_but_not_secret_rotation(logged_in, monkeypatch):
    cookie = logged_in.cookies.get("notebook_session")
    with TestClient(create_app()) as restarted:
        restarted.cookies.set("notebook_session", cookie)
        assert restarted.get("/api/vocabulary").status_code == 200
    monkeypatch.setenv("SESSION_SECRET", "a-different-secret-at-least-32-characters")
    with TestClient(create_app()) as rotated:
        rotated.cookies.set("notebook_session", cookie)
        assert rotated.get("/api/vocabulary").status_code == 401


def test_production_cookies_are_secure_and_httponly(client, monkeypatch):
    monkeypatch.setenv("COOKIE_SECURE", "true")
    monkeypatch.setenv("PUBLIC_ORIGIN", "https://testserver")
    with TestClient(create_app(), base_url="https://testserver") as secure_client:
        response = secure_client.post(
            "/api/auth/login",
            json={"password": "test-notebook-password"},
            headers=csrf(secure_client),
        )
        assert response.status_code == 200
        assert "Secure" in response.headers["set-cookie"]
        assert "HttpOnly" in response.headers["set-cookie"]
        assert "SameSite=strict" in response.headers["set-cookie"]


def test_forged_session_and_csrf_tokens_do_not_open_gate(client):
    client.cookies.set("notebook_session", "forged-token")
    assert client.get("/api/vocabulary").status_code == 401
    client.cookies.set("notebook_csrf", "nonce.forged-signature")
    assert (
        client.post(
            "/api/auth/login",
            json={"password": "test-notebook-password"},
            headers={"X-CSRF-Token": "nonce.forged-signature"},
        ).status_code
        == 403
    )


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
