"""Start a compatible disposable test database without changing existing containers."""

import json
import subprocess
import sys
import time

IMAGE = "postgres:18-alpine"
PASSWORD = "lexi-test-only"
BINDING = {"5432/tcp": [{"HostIp": "127.0.0.1", "HostPort": "55432"}]}


def docker(*args):
    return subprocess.check_output(["docker", *args], text=True, stderr=subprocess.PIPE)


def start(name):
    names = docker("container", "ls", "--all", "--format", "{{.Names}}").splitlines()
    if name in names:
        info = json.loads(docker("container", "inspect", name))[0]
        config = info["Config"]
        env = dict(item.split("=", 1) for item in config.get("Env", []) if "=" in item)
        compatible = (
            config["Image"] == IMAGE
            and info["HostConfig"]["PortBindings"] == BINDING
            and env.get("POSTGRES_DB") == "lexi_test"
            and env.get("POSTGRES_USER", "postgres") == "postgres"
            and env.get("POSTGRES_PASSWORD") == PASSWORD
            and env.get("POSTGRES_HOST_AUTH_METHOD", "scram-sha-256") == "scram-sha-256"
            and env.get("PGDATA", "/var/lib/postgresql/18/docker")
            == "/var/lib/postgresql/18/docker"
        )
        if not compatible:
            raise ValueError(
                "Existing test container has incompatible image, credentials, or ports. "
                "It was not started or changed. See README.md: Tests and checks."
            )
        if not info["State"]["Running"]:
            docker("start", name)
    else:
        docker(
            "run",
            "-d",
            "--name",
            name,
            "-e",
            f"POSTGRES_PASSWORD={PASSWORD}",
            "-e",
            "POSTGRES_DB=lexi_test",
            "-p",
            "127.0.0.1:55432:5432",
            IMAGE,
        )
    for _ in range(30):
        try:
            version = docker(
                "exec",
                "-e",
                f"PGPASSWORD={PASSWORD}",
                name,
                "psql",
                "-h",
                "127.0.0.1",
                "-U",
                "postgres",
                "-d",
                "lexi_test",
                "-Atc",
                "SHOW server_version_num",
            ).strip()
            if not 180000 <= int(version) < 190000:
                raise ValueError("Test database must run PostgreSQL 18.")
            print("PostgreSQL 18 test database ready at 127.0.0.1:55432/lexi_test.")
            return
        except subprocess.CalledProcessError:
            time.sleep(1)
    raise ValueError("Test database did not become ready within 30 attempts.")


if __name__ == "__main__":
    try:
        start(sys.argv[1])
    except (OSError, subprocess.CalledProcessError):
        sys.exit(
            "Docker command failed. Check that Docker is available; no containers were removed."
        )
    except (ValueError, KeyError, IndexError) as error:
        sys.exit(str(error))
