"""Run release schema migrations on a dedicated private-network runner."""

import os
import re
import subprocess
import sys


def main():
    sha = os.environ.get("SOURCE_SHA", "")
    image = os.environ.get("RELEASE_IMAGE", "")
    if not re.fullmatch(r"[0-9a-f]{40}", sha):
        raise ValueError("Invalid release source identity.")
    if os.environ.get("MIGRATION_AUTHORIZED_SHA") != sha:
        raise ValueError("Migration authorization does not match this release.")
    if not re.fullmatch(r"ghcr.io/fvoulgari/lexi@sha256:[0-9a-f]{64}", image):
        raise ValueError("Migration image must be the verified release digest.")
    url = os.environ.get("MIGRATION_DATABASE_URL")
    if not url:
        raise ValueError("Separate migration database credential is missing.")
    env = os.environ.copy()
    env["DATABASE_URL"] = url
    # The image runs with only the migration credential for this short-lived job.
    # Suppress process output: database errors may include connection details.
    for command in (["alembic", "upgrade", "head"],
                    ["python", "-m", "app.legacy_retirement_ready"]):
        result = subprocess.run(
            ["docker", "run", "--rm", "--network", "host", "-e", "DATABASE_URL",
             image, *command],
            env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False,
        )
        if result.returncode:
            raise ValueError("Schema or legacy-content gate failed; deployment was not started.")
    print("Release schema and legacy-content gates passed.")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError) as exc:
        print(f"Migration gate failed: {exc}", file=sys.stderr)
        sys.exit(1)
