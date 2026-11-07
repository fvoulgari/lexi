"""Bounded, inert staging reproduction; nonzero exit means the release gate fails.

Run after a quiet window: python3 scripts/verify-auth-rate-limit.py --limit 5
Never sends credentials, starts OAuth, sends email or targets production.
"""

import argparse
import http.client
import json
import time


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int, choices=range(1, 11), default=5)
    args = parser.parse_args()
    connection = http.client.HTTPSConnection("staging-lexi.fotiniv.com", timeout=20)
    started = time.monotonic()
    rows = []
    try:
        for index in range(args.limit + 2):
            connection.request(
                "GET",
                "/api/auth/authorisationurl",
                headers={
                    "Cache-Control": "no-cache",
                    "User-Agent": "Mozilla/5.0 Lexi-staging-rate-check",
                },
            )
            response = connection.getresponse()
            response.read()
            rows.append(
                {
                    "request": index + 1,
                    "http": response.status,
                    "retry_after": response.getheader("Retry-After"),
                }
            )
    except (OSError, http.client.HTTPException) as error:
        # Exception text may contain transport addresses; record only the type.
        print(json.dumps({"result": "ERROR", "error_type": type(error).__name__}))
        return 2
    finally:
        connection.close()
    passed = [row["http"] for row in rows] == [400] * args.limit + [429, 429]
    print(
        json.dumps(
            {
                "result": "PASS" if passed else "FAIL",
                "method": "GET",
                "path": "/api/auth/authorisationurl",
                "limit": args.limit,
                "elapsed_seconds": round(time.monotonic() - started, 3),
                "responses": rows,
            },
            indent=2,
        )
    )
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
