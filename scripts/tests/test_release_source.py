"""Resolve real Git release tags and reject unsafe image-tag mappings."""

import os
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


class ReleaseSourceTests(unittest.TestCase):
    def test_lightweight_and_annotated_tags_resolve_older_commits(self):
        with tempfile.TemporaryDirectory() as repository:

            def git(*args):
                return subprocess.check_output(
                    ["git", *args], cwd=repository, text=True, timeout=10
                ).strip()

            git("init", "-q")
            git("config", "user.name", "CI test")
            git("config", "user.email", "ci@example.invalid")
            git("commit", "--allow-empty", "-qm", "Release commit")
            sha = git("rev-parse", "HEAD")
            git("tag", "v1.0.0")
            git("tag", "-a", "v1.1.0-rc.1", "-m", "Prerelease")
            git("commit", "--allow-empty", "-qm", "Newer main commit")
            for tag in ["v1.0.0", "v1.1.0-rc.1"]:
                result = subprocess.run(
                    ["bash", str(ROOT / "scripts/release-source.sh")],
                    cwd=repository,
                    env={**os.environ, "RELEASE_TAG": tag},
                    capture_output=True,
                    text=True,
                    timeout=10,
                )
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(result.stdout.strip(), sha)
            for tag in ["latest", "sha-example", "v1/2", "missing-tag"]:
                if tag != "missing-tag":
                    git("tag", tag)
                result = subprocess.run(
                    ["bash", str(ROOT / "scripts/release-source.sh")],
                    cwd=repository,
                    env={**os.environ, "RELEASE_TAG": tag},
                    capture_output=True,
                    text=True,
                    timeout=10,
                )
                self.assertNotEqual(result.returncode, 0)


if __name__ == "__main__":
    unittest.main()
