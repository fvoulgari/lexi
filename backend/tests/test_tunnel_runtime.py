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


@pytest.mark.parametrize(
    "scenario", ["never_ready", "loses_readiness", "recovers", "signal"]
)
def test_watchdog_readiness_and_graceful_shutdown(monkeypatch, scenario):
    from app import tunnel_runtime as runtime

    monkeypatch.setenv("RAILWAY_ENVIRONMENT_ID", STAGING_ENVIRONMENT)
    monkeypatch.setenv("AUTH_INGRESS_MODE", "cloudflare_tunnel")
    monkeypatch.setenv("CLOUDFLARE_TUNNEL_TOKEN", "synthetic-token")
    clock, children, handlers = [0], [], {}
    monkeypatch.setattr(runtime.time, "monotonic", lambda: clock[0])
    monkeypatch.setattr(
        runtime.signal, "signal", lambda key, value: handlers.update({key: value})
    )

    class Child:
        def __init__(self, *args, **kwargs):
            self.terminated = False
            children.append(self)

        def poll(self):
            return 0 if self.terminated else None

        def terminate(self):
            self.terminated = True

        def wait(self, timeout):
            return 0

    def sleep(seconds):
        clock[0] += seconds
        if scenario in {"recovers", "signal"} and clock[0] == 40:
            handlers[runtime.signal.SIGTERM]()

    def healthy(*_):
        if scenario == "never_ready":
            return False
        if scenario == "loses_readiness":
            return clock[0] < 4
        if scenario == "recovers":
            return not 4 <= clock[0] < 20
        return True

    monkeypatch.setattr(runtime.time, "sleep", sleep)
    monkeypatch.setattr(runtime.subprocess, "Popen", Child)
    monkeypatch.setattr(runtime, "healthy", healthy)
    assert runtime.main() == (0 if scenario in {"recovers", "signal"} else 1)
    assert all(child.terminated for child in children)
    assert (
        clock[0]
        == {"never_ready": 90, "loses_readiness": 34, "recovers": 40, "signal": 40}[
            scenario
        ]
    )


def test_readiness_checks_both_loopback_services_without_environment_proxy(monkeypatch):
    from types import SimpleNamespace
    from unittest.mock import MagicMock

    from app import runtime_health

    opener = MagicMock()
    opener.open.return_value.__enter__.return_value = SimpleNamespace(status=200)
    build = MagicMock(return_value=opener)
    monkeypatch.setattr(runtime_health, "build_opener", build)
    assert runtime_health.healthy("cloudflare_tunnel", 8000)
    assert [call.args[0] for call in opener.open.call_args_list] == [
        "http://127.0.0.1:8000/api/health",
        "http://127.0.0.1:2000/ready",
    ]
    assert build.call_args.args[0].proxies == {}
    opener.open.side_effect = OSError("connector unavailable")
    assert not runtime_health.healthy("cloudflare_tunnel", 8000)
