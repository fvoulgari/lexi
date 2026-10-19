"""Exercise safe container reuse at the Docker command boundary."""

import copy
import importlib.util
import json
import subprocess
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    "test_db", Path(__file__).resolve().parents[1] / "test-db.py"
)
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)


class TestDatabaseTests(unittest.TestCase):
    def setUp(self):
        self.info = {
            "Config": {
                "Image": "postgres:18-alpine",
                "Env": ["POSTGRES_DB=lexi_test", "POSTGRES_PASSWORD=lexi-test-only"],
            },
            "HostConfig": {"PortBindings": copy.deepcopy(helper.BINDING)},
            "State": {"Running": False},
        }
        self.exists = True
        self.calls = []

    def docker(self, *args):
        self.calls.append(args)
        if args[:2] == ("container", "ls"):
            return "test-db\n" if self.exists else ""
        if args[:2] == ("container", "inspect"):
            return json.dumps([self.info])
        if args[0] == "exec":
            return "180001\n"
        return ""

    def run_helper(self):
        with patch.object(helper, "docker", side_effect=self.docker):
            helper.start("test-db")

    def test_new_database_uses_loopback_and_postgresql_18(self):
        self.exists = False
        self.run_helper()
        run = next(call for call in self.calls if call[0] == "run")
        self.assertEqual(run[-1], "postgres:18-alpine")
        self.assertEqual(run[run.index("-p") + 1], "127.0.0.1:55432:5432")

    def test_compatible_stopped_database_is_started_without_recreation(self):
        self.run_helper()
        self.assertIn(("start", "test-db"), self.calls)
        self.assertFalse(any(call[0] in {"run", "rm"} for call in self.calls))

    def test_running_database_is_not_restarted(self):
        self.info["State"]["Running"] = True
        self.run_helper()
        self.assertFalse(any(call[0] in {"start", "run", "rm"} for call in self.calls))

    def test_incompatible_containers_are_rejected_before_start(self):
        original = copy.deepcopy(self.info)
        variants = []
        for image in ["postgres:17-alpine", "unrelated:latest"]:
            value = copy.deepcopy(original)
            value["Config"]["Image"] = image
            variants.append(value)
        for ip, port in [("0.0.0.0", "55432"), ("127.0.0.1", "5432")]:
            value = copy.deepcopy(original)
            value["HostConfig"]["PortBindings"]["5432/tcp"] = [
                {"HostIp": ip, "HostPort": port}
            ]
            variants.append(value)
        for env in [
            ["POSTGRES_DB=notebook", "POSTGRES_PASSWORD=lexi-test-only"],
            ["POSTGRES_DB=lexi_test", "POSTGRES_PASSWORD=wrong"],
            original["Config"]["Env"] + ["POSTGRES_HOST_AUTH_METHOD=trust"],
            original["Config"]["Env"] + ["PGDATA=/var/lib/postgresql/data"],
        ]:
            value = copy.deepcopy(original)
            value["Config"]["Env"] = env
            variants.append(value)
        for value in variants:
            with self.subTest(value=value):
                self.info = value
                self.calls = []
                with self.assertRaisesRegex(ValueError, "not started or changed"):
                    self.run_helper()
                self.assertTrue(all(call[0] == "container" for call in self.calls))

    def test_docker_failure_does_not_create_a_replacement(self):
        with patch.object(
            helper, "docker", side_effect=subprocess.CalledProcessError(1, "docker")
        ) as docker:
            with self.assertRaises(subprocess.CalledProcessError):
                helper.start("test-db")
            self.assertEqual(docker.call_count, 1)

    def test_wrong_running_major_is_rejected(self):
        def docker(*args):
            return "170001\n" if args[0] == "exec" else self.docker(*args)

        with (
            patch.object(helper, "docker", side_effect=docker),
            self.assertRaisesRegex(ValueError, "must run PostgreSQL 18"),
        ):
            helper.start("test-db")
