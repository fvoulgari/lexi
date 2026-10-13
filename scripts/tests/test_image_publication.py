"""Observe publication through a disposable Docker registry, not workflow internals."""

import os
import subprocess
import tempfile
import time
import unittest
import uuid
from pathlib import Path
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[2]
LABEL = "io.github.fvoulgari.lexi.main-run-number"


def docker(*args):
    return subprocess.check_output(["docker", *args], text=True, timeout=90).strip()


class ImagePublicationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.registry = f"lexi-publication-test-{uuid.uuid4().hex[:8]}"
        port = os.environ.get("TEST_REGISTRY_PORT", "5058")
        docker("run", "-d", "--name", cls.registry, "-p", f"{port}:5000", "registry:3")
        cls.addClassCleanup(docker, "rm", "-f", cls.registry)
        cls.image = f"127.0.0.1:{port}/lexi"
        for attempt in range(50):
            try:
                with urlopen(f"http://127.0.0.1:{port}/v2/", timeout=1):
                    break
            except OSError:
                time.sleep(0.1)
        else:
            raise RuntimeError("Disposable registry did not become ready")
        cls.directory = tempfile.TemporaryDirectory()
        cls.addClassCleanup(cls.directory.cleanup)
        Path(cls.directory.name, "Dockerfile").write_text("FROM scratch\n")

    def setUp(self):
        self.image = f"{type(self).image}/{uuid.uuid4().hex[:8]}"

    def publish(self, number):
        sha = f"{number:040x}"
        tag = f"{self.image}:sha-{sha}"
        docker(
            "build",
            "--platform",
            "linux/amd64",
            "--label",
            f"{LABEL}={number}",
            "--label",
            f"org.opencontainers.image.revision={sha}",
            "-t",
            tag,
            self.directory.name,
        )
        docker("push", tag)
        self.assertEqual(
            docker("inspect", "--format", "{{.Os}}/{{.Architecture}}", tag),
            "linux/amd64",
        )
        return sha

    def promote(self, sha, number, image=None):
        return subprocess.run(
            ["bash", str(ROOT / "scripts/promote-latest.sh")],
            env={
                **os.environ,
                "IMAGE": image or self.image,
                "SOURCE_SHA": sha,
                "MAIN_RUN_NUMBER": str(number),
            },
            capture_output=True,
            text=True,
            timeout=90,
        )

    def revision(self, tag):
        docker("pull", f"{self.image}:{tag}")
        return docker(
            "inspect",
            "--format",
            '{{ index .Config.Labels "org.opencontainers.image.revision" }}',
            f"{self.image}:{tag}",
        )

    def test_latest_never_regresses_and_sha_images_remain_available(self):
        first = self.publish(10)
        newer = self.publish(30)
        older = self.publish(20)
        result = self.promote(first, 10)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.revision("latest"), first)
        result = self.promote(newer, 30)
        self.assertEqual(result.returncode, 0, result.stderr)
        for sha, number in [(older, 20), (first, 10), (newer, 30)]:
            result = self.promote(sha, number)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(self.revision("latest"), newer)
            self.assertEqual(self.revision(f"sha-{sha}"), sha)

    def test_mismatched_candidate_does_not_create_latest(self):
        sha = self.publish(10)
        result = self.promote(sha, 20)
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        with self.assertRaises(subprocess.CalledProcessError):
            docker("pull", f"{self.image}:latest")

    def test_stable_and_prerelease_tags_preserve_latest_and_existing_sha(self):
        latest_sha = self.publish(30)
        self.assertEqual(self.promote(latest_sha, 30).returncode, 0)
        with tempfile.TemporaryDirectory() as repository:

            def git(*args):
                return subprocess.check_output(
                    ["git", *args], cwd=repository, text=True, timeout=10
                ).strip()

            git("init", "-q")
            git("config", "user.name", "CI test")
            git("config", "user.email", "ci@example.invalid")
            Path(repository, "Dockerfile").write_text("FROM scratch\n")
            git("add", "Dockerfile")
            git("commit", "-qm", "Release source")
            sha = git("rev-parse", "HEAD")
            git("tag", "v1.2.0")
            git("tag", "-a", "v1.3.0-rc.1", "-m", "Annotated prerelease")
            self.assertNotEqual(git("rev-parse", "v1.3.0-rc.1"), sha)
            for tag in ["v1.2.0", "v1.3.0-rc.1"]:
                if tag == "v1.3.0-rc.1":
                    # A main SHA build may exist before its latest promotion.
                    docker(
                        "build",
                        "--platform",
                        "linux/amd64",
                        "--label",
                        f"{LABEL}=99",
                        "--label",
                        f"org.opencontainers.image.revision={sha}",
                        "-t",
                        f"{self.image}:sha-{sha}",
                        repository,
                    )
                    docker("push", f"{self.image}:sha-{sha}")
                    original_id = docker(
                        "inspect", "--format", "{{.Id}}", f"{self.image}:sha-{sha}"
                    )
                result = subprocess.run(
                    ["bash", str(ROOT / "scripts/publish-release.sh")],
                    cwd=repository,
                    env={
                        **os.environ,
                        "IMAGE": self.image,
                        "SOURCE_SHA": sha,
                        "RELEASE_TAG": tag,
                    },
                    capture_output=True,
                    text=True,
                    timeout=90,
                )
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertEqual(self.revision(tag), sha)
                self.assertEqual(self.revision(f"sha-{sha}"), sha)
                self.assertEqual(self.revision("latest"), latest_sha)
                if tag == "v1.3.0-rc.1":
                    self.assertEqual(
                        docker(
                            "inspect", "--format", "{{.Id}}", f"{self.image}:sha-{sha}"
                        ),
                        original_id,
                    )
                    self.assertEqual(
                        docker(
                            "inspect",
                            "--format",
                            f'{{{{ index .Config.Labels "{LABEL}" }}}}',
                            f"{self.image}:sha-{sha}",
                        ),
                        "99",
                    )
            digest = docker("inspect", "--format", "{{.Id}}", f"{self.image}:sha-{sha}")
            self.assertEqual(
                docker("inspect", "--format", "{{.Id}}", f"{self.image}:v1.3.0-rc.1"),
                digest,
            )

    def test_registry_failure_does_not_count_as_missing_latest(self):
        result = self.promote("0" * 40, 40, "127.0.0.1:1/lexi")
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
