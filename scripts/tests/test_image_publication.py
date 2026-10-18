"""Observe publication through a disposable Docker registry, not workflow internals."""

import json
import os
import subprocess
import tempfile
import time
import unittest
import uuid
from pathlib import Path
from urllib.request import Request, urlopen

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
            check=False,
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

    def test_stable_tags_preserve_latest_and_existing_sha(self):
        latest_sha = self.publish(30)
        self.assertEqual(self.promote(latest_sha, 30).returncode, 0)
        repository, git, sha = self.release_repository()
        git("tag", "-a", "v1.3.0", "-m", "Annotated stable release")
        self.assertNotEqual(git("rev-parse", "v1.3.0"), sha)
        for tag in ["v1.2.0", "v1.3.0"]:
            if tag == "v1.3.0":
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
            result = self.release(repository, sha, tag=tag)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertEqual(self.revision(tag), sha)
            self.assertEqual(self.revision(f"sha-{sha}"), sha)
            self.assertEqual(self.revision("latest"), latest_sha)
            if tag == "v1.3.0":
                self.assertEqual(
                    docker("inspect", "--format", "{{.Id}}", f"{self.image}:sha-{sha}"),
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
            docker("inspect", "--format", "{{.Id}}", f"{self.image}:v1.3.0"),
            digest,
        )

    def release_repository(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        repository = directory.name

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
        git("update-ref", "refs/remotes/origin/main", sha)
        git("tag", "v1.2.0")
        return repository, git, sha

    def release(self, repository, sha, image=None, output=None, tag="v1.2.0"):
        return subprocess.run(
            ["bash", str(ROOT / "scripts/publish-release.sh")],
            cwd=repository,
            env={
                **os.environ,
                "IMAGE": image or self.image,
                "SOURCE_SHA": sha,
                "RELEASE_TAG": tag,
                **({"GITHUB_OUTPUT": str(output)} if output else {}),
            },
            check=False,
            capture_output=True,
            text=True,
            timeout=90,
        )

    def digest(self, tag):
        registry, repository = self.image.split("/", 1)
        request = Request(
            f"http://{registry}/v2/{repository}/manifests/{tag}",
            headers={
                "Accept": (
                    "application/vnd.docker.distribution.manifest.v2+json, "
                    "application/vnd.docker.distribution.manifest.list.v2+json, "
                    "application/vnd.oci.image.manifest.v1+json, "
                    "application/vnd.oci.image.index.v1+json"
                )
            },
        )
        with urlopen(request, timeout=10) as response:
            return response.headers["Docker-Content-Digest"]

    def test_release_rerun_preserves_digest_and_exports_pinned_image(self):
        repository, _, sha = self.release_repository()
        output = Path(repository, "outputs")
        first = self.release(repository, sha, output=output)
        self.assertEqual(first.returncode, 0, first.stdout + first.stderr)
        digest = self.digest("v1.2.0")
        self.assertIn(f"digest={digest}\n", output.read_text())
        self.assertIn(f"image={self.image}@{digest}\n", output.read_text())
        again = self.release(repository, sha)
        self.assertEqual(again.returncode, 0, again.stdout + again.stderr)
        self.assertEqual(self.digest("v1.2.0"), digest)

    def test_release_preserves_existing_sha_index_digest(self):
        self.check_registry_manifest_preserved(index=True)

    def test_release_preserves_existing_sha_oci_manifest_digest(self):
        self.check_registry_manifest_preserved(index=False)

    def check_registry_manifest_preserved(self, *, index):
        repository, _, sha = self.release_repository()
        docker(
            "buildx",
            "build",
            "--platform",
            "linux/amd64",
            "--provenance=false",
            "--push",
            "--label",
            f"org.opencontainers.image.revision={sha}",
            "-t",
            f"{self.image}:sha-{sha}",
            repository,
        )
        leaf = self.digest(f"sha-{sha}")
        registry, image_path = self.image.split("/", 1)
        raw = docker(
            "buildx", "imagetools", "inspect", "--raw", f"{self.image}@{leaf}"
        ).encode()
        manifest = {
            "schemaVersion": 2,
            "mediaType": "application/vnd.oci.image.index.v1+json",
            "manifests": [
                {
                    "mediaType": json.loads(raw)["mediaType"],
                    "digest": leaf,
                    "size": len(raw),
                    "platform": {"os": "linux", "architecture": "amd64"},
                }
            ],
        }
        if not index:
            manifest = json.loads(raw)
            manifest["mediaType"] = "application/vnd.oci.image.manifest.v1+json"
            manifest["config"]["mediaType"] = "application/vnd.oci.image.config.v1+json"
            for layer in manifest["layers"] or []:
                layer["mediaType"] = "application/vnd.oci.image.layer.v1.tar+gzip"
        payload = json.dumps(manifest, indent=2).encode()
        request = Request(
            f"http://{registry}/v2/{image_path}/manifests/sha-{sha}",
            data=payload,
            method="PUT",
            headers={"Content-Type": manifest["mediaType"]},
        )
        with urlopen(request, timeout=10):
            pass
        original = self.digest(f"sha-{sha}")
        self.assertNotEqual(
            original, leaf, "Fixture must have a distinct registry manifest"
        )
        output = Path(repository, "outputs")
        result = self.release(repository, sha, output=output)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(self.digest("v1.2.0"), original)
        self.assertIn(f"image={self.image}@{original}\n", output.read_text())

    def test_existing_release_restores_missing_sha_without_rebuilding(self):
        repository, _, sha = self.release_repository()
        docker(
            "build",
            "--platform",
            "linux/amd64",
            "--provenance=false",
            "--label",
            f"org.opencontainers.image.revision={sha}",
            "-t",
            f"{self.image}:v1.2.0",
            repository,
        )
        docker("push", f"{self.image}:v1.2.0")
        original = self.digest("v1.2.0")
        result = self.release(repository, sha)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(self.digest(f"sha-{sha}"), original)
        self.assertEqual(self.digest("v1.2.0"), original)

    def test_same_revision_with_different_content_cannot_replace_release(self):
        repository, _, sha = self.release_repository()
        first = self.release(repository, sha)
        self.assertEqual(first.returncode, 0, first.stderr)
        original = self.digest("v1.2.0")
        docker(
            "build",
            "--platform",
            "linux/amd64",
            "--provenance=false",
            "--label",
            f"org.opencontainers.image.revision={sha}",
            "--label",
            "test.changed-content=true",
            "-t",
            f"{self.image}:sha-{sha}",
            repository,
        )
        docker("push", f"{self.image}:sha-{sha}")
        result = self.release(repository, sha)
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(self.digest("v1.2.0"), original)

    def test_invalid_existing_sha_metadata_prevents_release(self):
        repository, _, sha = self.release_repository()
        wrong_sha = self.publish(10)
        docker("tag", f"{self.image}:sha-{wrong_sha}", f"{self.image}:sha-{sha}")
        docker("push", f"{self.image}:sha-{sha}")
        result = self.release(repository, sha)
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        with self.assertRaises(subprocess.CalledProcessError):
            docker("pull", f"{self.image}:v1.2.0")

    def test_wrong_platform_sha_prevents_release(self):
        repository, _, sha = self.release_repository()
        docker(
            "build",
            "--platform",
            "linux/arm64",
            "--provenance=false",
            "--label",
            f"org.opencontainers.image.revision={sha}",
            "-t",
            f"{self.image}:sha-{sha}",
            repository,
        )
        docker("push", f"{self.image}:sha-{sha}")
        result = self.release(repository, sha)
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        with self.assertRaises(subprocess.CalledProcessError):
            docker("pull", f"{self.image}:v1.2.0")

    def test_registry_failure_does_not_count_as_missing_release(self):
        repository, _, sha = self.release_repository()
        result = self.release(repository, sha, image="127.0.0.1:1/lexi")
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_recreated_release_tag_cannot_replace_published_version(self):
        repository, git, sha = self.release_repository()
        first = self.release(repository, sha)
        self.assertEqual(first.returncode, 0, first.stderr)
        git("tag", "-d", "v1.2.0")
        git("commit", "--allow-empty", "-qm", "New release source")
        new_sha = git("rev-parse", "HEAD")
        git("update-ref", "refs/remotes/origin/main", new_sha)
        git("tag", "v1.2.0")
        result = self.release(repository, new_sha)
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(self.revision("v1.2.0"), sha)

    def test_registry_failure_does_not_count_as_missing_latest(self):
        result = self.promote("0" * 40, 40, "127.0.0.1:1/lexi")
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
