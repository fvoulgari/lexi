"""Staging-only, fail-closed supervision of loopback Lexi and cloudflared."""

import os
import signal
import subprocess
import sys
import tempfile
import time

from app.runtime_health import healthy

STAGING_ENVIRONMENT = "8bb27c88-f6a8-4074-b701-bcefb982ab2d"


def commands(environment, token_path):
    if environment.get("RAILWAY_ENVIRONMENT_ID") != STAGING_ENVIRONMENT:
        raise ValueError("Tunnel proof of concept is restricted to staging")
    if environment.get("AUTH_INGRESS_MODE") != "cloudflare_tunnel":
        raise ValueError("Tunnel ingress mode is required")
    port = int(environment.get("PORT", "8000"))
    if not 1 <= port <= 65535:
        raise ValueError("Invalid application port")
    return [
        [
            sys.executable,
            "-m",
            "uvicorn",
            "app.main:create_app",
            "--factory",
            "--no-access-log",
            "--no-proxy-headers",
            "--host",
            "127.0.0.1",
            "--port",
            str(port),
        ],
        [
            "cloudflared",
            "tunnel",
            "--no-autoupdate",
            "--loglevel",
            "error",
            "--metrics",
            "127.0.0.1:2000",
            "run",
            "--token-file",
            token_path,
        ],
    ]


def main():
    environment = dict(os.environ)
    token = environment.pop("CLOUDFLARE_TUNNEL_TOKEN", "")
    # Keep the credential out of both children's environment and command line.
    os.environ.pop("CLOUDFLARE_TUNNEL_TOKEN", None)
    if not token or any(character.isspace() for character in token):
        raise SystemExit("A sealed Tunnel token is required")
    children = []
    stopping = False

    def stop(_signum=None, _frame=None):
        nonlocal stopping
        stopping = True
        for child in children:
            if child.poll() is None:
                child.terminate()

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    with tempfile.TemporaryDirectory(prefix="lexi-tunnel-") as directory:
        path = os.path.join(directory, "token")
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "w") as destination:
            destination.write(token)
        del token
        try:
            for command in commands(environment, path):
                if stopping:
                    break
                children.append(subprocess.Popen(command, env=environment))
            startup_deadline = time.monotonic() + 90
            ever_ready = False
            unready_since = None
            while not stopping and all(child.poll() is None for child in children):
                now = time.monotonic()
                if healthy("cloudflare_tunnel", int(environment.get("PORT", "8000"))):
                    ever_ready = True
                    unready_since = None
                else:
                    if unready_since is None:
                        unready_since = now
                    if (not ever_ready and now >= startup_deadline) or (
                        ever_ready and now - unready_since >= 30
                    ):
                        print("tunnel_runtime_unready", flush=True)
                        break
                time.sleep(2)
            status = 0 if stopping else 1
        finally:
            stop()
            deadline = time.monotonic() + 10
            for child in children:
                try:
                    child.wait(timeout=max(0.1, deadline - time.monotonic()))
                except subprocess.TimeoutExpired:
                    child.kill()
                    child.wait()
    return status


if __name__ == "__main__":
    raise SystemExit(main())
