"""Resolve real Git tags to stable release commits on main."""

import os
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


class ReleaseSourceTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.repository = directory.name
        self.git("init", "-q")
        self.git("config", "user.name", "CI test")
        self.git("config", "user.email", "ci@example.invalid")
        self.git("commit", "--allow-empty", "-qm", "Release commit")
        self.sha = self.git("rev-parse", "HEAD")
        self.git("update-ref", "refs/remotes/origin/main", self.sha)

    def git(self, *args):
        return subprocess.check_output(
            ["git", *args], cwd=self.repository, text=True, timeout=10
        ).strip()

    def resolve(self, tag, *args, **env):
        return subprocess.run(
            ["bash", str(ROOT / "scripts/release-source.sh"), *args],
            cwd=self.repository,
            env={**os.environ, "RELEASE_TAG": tag, **env},
            check=False,
            capture_output=True,
            text=True,
            timeout=10,
        )

    def test_lightweight_and_annotated_tags_resolve_older_main_commits(self):
        self.git("tag", "v1.0.0")
        self.git("tag", "-a", "v1.1.0", "-m", "Stable release")
        self.git("commit", "--allow-empty", "-qm", "Newer main commit")
        self.git("update-ref", "refs/remotes/origin/main", "HEAD")
        for tag in ["v1.0.0", "v1.1.0"]:
            with self.subTest(tag=tag):
                result = self.resolve(tag)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(result.stdout.strip(), self.sha)

    def test_only_canonical_stable_versions_are_eligible(self):
        for tag in ["v0.0.0", "v1.2.3", "v10.20.300"]:
            with self.subTest(tag=tag):
                self.git("tag", tag)
                self.assertEqual(self.resolve(tag, "--check-tag").returncode, 0)
        for tag in [
            "v1.0.0-rc.1",
            "v1.0.0+build",
            "v01.2.3",
            "v1.02.3",
            "v1.2.03",
            "1.2.3",
            "v1.2",
            "v1.2.3.4",
            "latest",
            "sha-x",
            "v1/2",
            "v" + "1" * 125 + ".0.0",
        ]:
            with self.subTest(tag=tag):
                self.git("tag", tag)
                result = self.resolve(tag, "--check-tag")
                self.assertNotEqual(result.returncode, 0, tag)

    def test_rejects_a_tag_outside_main_or_without_main_history(self):
        self.git("commit", "--allow-empty", "-qm", "Unmerged commit")
        self.git("tag", "v2.0.0")
        self.assertNotEqual(self.resolve("v2.0.0").returncode, 0)
        self.git("update-ref", "-d", "refs/remotes/origin/main")
        self.git("tag", "v1.0.0", self.sha)
        self.assertNotEqual(self.resolve("v1.0.0").returncode, 0)

    def test_rejects_a_tag_moved_since_the_triggering_event(self):
        self.git("tag", "v1.0.0")
        self.git("commit", "--allow-empty", "-qm", "New main commit")
        new_sha = self.git("rev-parse", "HEAD")
        self.git("update-ref", "refs/remotes/origin/main", new_sha)
        self.git("tag", "-f", "v1.0.0")
        self.assertNotEqual(self.resolve("v1.0.0", EXPECTED_SHA=self.sha).returncode, 0)
