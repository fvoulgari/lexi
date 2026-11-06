import pytest

from app.tunnel_runtime import STAGING_ENVIRONMENT, commands


def test_staging_runtime_has_no_public_listener_or_proxy_header_trust():
    environment = {
        "RAILWAY_ENVIRONMENT_ID": STAGING_ENVIRONMENT,
        "AUTH_INGRESS_MODE": "cloudflare_tunnel",
        "PORT": "8000",
    }
    app, connector = commands(environment, "/private/token")
    assert app[app.index("--host") + 1] == "127.0.0.1"
    assert "--no-proxy-headers" in app
    assert "--proxy-headers" not in app
    assert connector[connector.index("--metrics") + 1] == "127.0.0.1:2000"
    assert connector[-2:] == ["--token-file", "/private/token"]


@pytest.mark.parametrize(
    "environment",
    [
        {},
        {
            "RAILWAY_ENVIRONMENT_ID": "production",
            "AUTH_INGRESS_MODE": "cloudflare_tunnel",
        },
        {"RAILWAY_ENVIRONMENT_ID": STAGING_ENVIRONMENT},
        {
            "RAILWAY_ENVIRONMENT_ID": STAGING_ENVIRONMENT,
            "AUTH_INGRESS_MODE": "cloudflare_tunnel",
            "PORT": "0",
        },
    ],
)
def test_runtime_rejects_wrong_environment_or_configuration(environment):
    with pytest.raises(ValueError):
        commands(environment, "/private/token")


def test_supervisor_cleans_up_both_children_and_token(monkeypatch):
    import os
    from pathlib import Path

    from app import tunnel_runtime

    environment = {
        "RAILWAY_ENVIRONMENT_ID": STAGING_ENVIRONMENT,
        "AUTH_INGRESS_MODE": "cloudflare_tunnel",
        "CLOUDFLARE_TUNNEL_TOKEN": "synthetic-test-token",
    }
    for key, value in environment.items():
        monkeypatch.setenv(key, value)
    monkeypatch.setattr(tunnel_runtime.signal, "signal", lambda *args: None)
    children = []
    token_paths = []

    class Child:
        def __init__(self, command, env):
            assert "CLOUDFLARE_TUNNEL_TOKEN" not in env
            assert "synthetic-test-token" not in command
            self.terminated = False
            if command[0] == "cloudflared":
                path = Path(command[-1])
                token_paths.append(path)
                assert path.stat().st_mode & 0o777 == 0o600
                assert path.read_text() == "synthetic-test-token"
            children.append(self)

        def poll(self):
            return 1 if self is children[0] else None

        def terminate(self):
            self.terminated = True

        def wait(self, timeout):
            return 0

    monkeypatch.setattr(tunnel_runtime.subprocess, "Popen", Child)
    assert tunnel_runtime.main() == 1
    assert children[1].terminated
    assert not token_paths[0].exists()
    assert "CLOUDFLARE_TUNNEL_TOKEN" not in os.environ
