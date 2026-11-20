"""Loopback-only app and connector readiness; never uses environment proxies."""

import os
from urllib.error import URLError
from urllib.request import ProxyHandler, build_opener


def healthy(mode, port):
    paths = [f"http://127.0.0.1:{port}/api/health"]
    if mode == "cloudflare_tunnel":
        paths.append("http://127.0.0.1:2000/ready")
    opener = build_opener(ProxyHandler({}))
    try:
        for path in paths:
            with opener.open(path, timeout=1) as response:
                if response.status != 200:
                    return False
    except OSError, URLError:
        return False
    return True


if __name__ == "__main__":
    raise SystemExit(
        0
        if healthy(
            os.environ.get("AUTH_INGRESS_MODE", "direct"),
            int(os.environ.get("PORT", "8000")),
        )
        else 1
    )
