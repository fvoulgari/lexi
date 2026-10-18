"""Run the release command against controlled GitHub and Railway HTTP APIs."""

import json
import os
import subprocess
import sys
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from socketserver import TCPServer
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parents[2]
PROJECT = "de2e2c78-8a6b-41aa-afeb-c6d8002ecc79"
ENVIRONMENT = "c41cced0-97ff-441b-b86e-38a191a48188"
SERVICE = "bbd1f305-9f32-4f08-af21-3e1a5f621265"
DEPLOYMENT = "11111111-1111-4111-8111-111111111111"
SHA = "a" * 40
IMAGE = "ghcr.io/fvoulgari/lexi@sha256:" + "b" * 64


class RailwayReleaseTests(unittest.TestCase):
    def setUp(self):
        self.records = []
        self.statuses = {}
        self.requests = []
        self.railway_states = ["DEPLOYING", "SUCCESS"]
        self.api_error = None
        self.reject_success = False
        self.reported_id = None
        self.deployed_image = IMAGE
        self.deployed_digest = IMAGE.split("@")[1]
        self.config_reads_remaining = 0
        self.pending_config = None
        self.config = {
            "services": {
                SERVICE: {
                    "source": {"image": "ghcr.io/fvoulgari/lexi:v1.1.2"},
                    "deploy": {
                        "healthcheckPath": "/api/health",
                        "healthcheckTimeout": 120,
                        "multiRegionConfig": {"sfo": {"numReplicas": 1}},
                    },
                }
            }
        }
        self.instance = {
            "serviceId": SERVICE,
            "environmentId": ENVIRONMENT,
            "source": {"image": "ghcr.io/fvoulgari/lexi:v1.1.2", "repo": None},
            "healthcheckPath": "/api/health",
            "healthcheckTimeout": 120,
            "numReplicas": 1,
            "latestDeployment": None,
        }
        owner = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_args):
                pass

            def respond(self, value, status=200):
                data = json.dumps(value).encode()
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(data)

            def do_GET(self):
                path = urlparse(self.path).path
                owner.requests.append(("GET", self.path, None))
                page = int(parse_qs(urlparse(self.path).query).get("page", ["1"])[0])
                offset = (page - 1) * 100
                if path.endswith("/deployments"):
                    self.respond(owner.records[offset : offset + 100])
                elif path.endswith("/statuses"):
                    number = int(path.split("/")[-2])
                    self.respond(owner.statuses.get(number, [])[offset : offset + 100])
                else:
                    self.respond({}, 404)

            def do_POST(self):
                # Railway edge filtering rejects urllib's default user agent.
                if self.path == "/railway" and self.headers.get(
                    "User-Agent", ""
                ).startswith("Python-urllib/"):
                    self.respond({"error": "blocked client"}, 403)
                    return
                data = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                owner.requests.append(("POST", self.path, data))
                if self.path == "/railway":
                    operation = data["operationName"]
                    if operation == owner.api_error:
                        self.respond(
                            {"errors": [{"message": "Rejected fixture request"}]}
                        )
                        return
                    if operation == "ReleaseInstance":
                        self.respond({"data": {"serviceInstance": owner.instance}})
                    elif operation == "ReleaseConfigure":
                        patch = data["variables"]["patch"]["services"][SERVICE]
                        owner.pending_config = {
                            "source": patch["source"],
                            "deploy": {
                                **owner.config["services"][SERVICE]["deploy"],
                                **patch["deploy"],
                            },
                        }
                        self.respond({"data": {"environmentPatchCommit": "patch-id"}})
                    elif operation == "ReleaseConfig":
                        if owner.pending_config and owner.config_reads_remaining > 0:
                            owner.config_reads_remaining -= 1
                        elif owner.pending_config:
                            owner.config["services"][SERVICE] = owner.pending_config
                            owner.pending_config = None
                        self.respond(
                            {"data": {"environment": {"config": owner.config}}}
                        )
                    elif operation == "ReleaseDeploy":
                        self.respond({"data": {"serviceInstanceDeployV2": DEPLOYMENT}})
                    elif operation == "ReleaseStatus":
                        state = owner.railway_states[0]
                        if len(owner.railway_states) > 1:
                            owner.railway_states.pop(0)
                        self.respond(
                            {
                                "data": {
                                    "deployment": {
                                        "id": owner.reported_id
                                        or data["variables"]["id"],
                                        "status": state,
                                        "projectId": PROJECT,
                                        "environmentId": ENVIRONMENT,
                                        "serviceId": SERVICE,
                                        "meta": {
                                            "image": owner.deployed_image,
                                            "imageDigest": owner.deployed_digest,
                                        },
                                    }
                                }
                            }
                        )
                    else:
                        self.respond({"errors": [{"message": "Unexpected operation"}]})
                elif self.path.endswith("/deployments"):
                    record = {"id": len(owner.records) + 1, "payload": data["payload"]}
                    owner.records.insert(0, record)
                    self.respond(record, 201)
                elif self.path.endswith("/statuses"):
                    number = int(self.path.split("/")[-2])
                    if data["state"] == "success" and owner.reject_success:
                        self.respond({}, 503)
                        return
                    owner.statuses.setdefault(number, []).insert(0, data)
                    self.respond(data, 201)
                else:
                    self.respond({}, 404)

        class LocalApiServer(ThreadingHTTPServer):
            def server_bind(self):
                # Keep the controlled API independent of reverse DNS.
                TCPServer.server_bind(self)
                self.server_name = "localhost"
                self.server_port = self.server_address[1]

        self.server = LocalApiServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)

    def release(self, tag="v1.2.0", **env):
        base = f"http://127.0.0.1:{self.server.server_port}"
        return subprocess.run(
            [sys.executable, str(ROOT / "scripts/deploy-release.py")],
            env={
                **os.environ,
                "RELEASE_TAG": tag,
                "SOURCE_SHA": SHA,
                "RELEASE_IMAGE": IMAGE,
                "GH_TOKEN": "test-github-token",
                "RAILWAY_TOKEN": "test-railway-token",
                "GITHUB_API_URL": base,
                "RAILWAY_API_URL": base + "/railway",
                "RELEASE_POLL_INTERVAL": "0",
                "RELEASE_TIMEOUT": "2",
                **env,
            },
            check=False,
            capture_output=True,
            text=True,
            timeout=10,
        )

    def test_deploys_pinned_image_and_records_success_only_after_readiness(self):
        result = self.release()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        operations = [body for _, path, body in self.requests if path == "/railway"]
        patch = next(
            body for body in operations if body["operationName"] == "ReleaseConfigure"
        )
        self.assertEqual(
            patch["variables"]["patch"]["services"][SERVICE]["source"], {"image": IMAGE}
        )
        self.assertTrue(patch["variables"]["skipDeploys"])
        self.assertEqual(self.statuses[1][0]["state"], "success")
        polls = [
            body for body in operations if body["operationName"] == "ReleaseStatus"
        ]
        self.assertEqual(
            [body["variables"]["id"] for body in polls], [DEPLOYMENT, DEPLOYMENT]
        )

    def test_baseline_and_lower_versions_never_mutate_production(self):
        for tag in ["v1.1.2", "v1.0.99", "v0.9.9"]:
            with self.subTest(tag=tag):
                result = self.release(tag)
                self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertFalse(
                    any(method == "POST" for method, _, _ in self.requests)
                )

    def seed(self, tag, states, image=IMAGE, identifier=None):
        record = {
            "id": len(self.records) + 1,
            "payload": {
                "schema": 1,
                "version": tag,
                "sha": SHA,
                "image": image,
            },
        }
        self.records.insert(0, record)
        self.statuses[record["id"]] = [{"state": state} for state in states]
        if identifier:
            self.statuses[record["id"]][0]["log_url"] = (
                f"https://railway.com/project/{PROJECT}/service/{SERVICE}?"
                f"environmentId={ENVIRONMENT}&deploymentId={identifier}"
            )
        return record

    def test_numeric_high_water_survives_inactive_status_and_failed_newer_release(self):
        self.seed("v1.10.0", ["inactive", "success"])
        self.seed("v1.11.0", ["failure"])
        result = self.release("v1.9.9")
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertFalse(any(method == "POST" for method, _, _ in self.requests))

    def test_successful_version_rerun_is_a_noop_and_conflicting_digest_is_rejected(
        self,
    ):
        self.seed("v1.2.0", ["success"])
        result = self.release()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertFalse(any(method == "POST" for method, _, _ in self.requests))
        result = self.release(RELEASE_IMAGE=IMAGE[:-1] + "c")
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(any(method == "POST" for method, _, _ in self.requests))

    def mutations(self):
        return [
            body
            for _, path, body in self.requests
            if path == "/railway"
            and body["operationName"] in {"ReleaseConfigure", "ReleaseDeploy"}
        ]

    def test_rerun_resumes_recorded_deployment_without_starting_another(self):
        self.seed("v1.2.0", ["in_progress"], identifier=DEPLOYMENT)
        result = self.release()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(len(self.records), 1)
        self.assertEqual(self.statuses[1][0]["state"], "success")
        self.assertEqual(self.mutations(), [])

    def test_uncertain_attempt_without_deployment_id_blocks_duplicate_rollout(self):
        self.seed("v1.2.0", ["queued"])
        result = self.release()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(len(self.records), 1)
        self.assertEqual(self.mutations(), [])

    def test_unrecorded_active_rollout_blocks_a_new_deployment(self):
        self.instance["latestDeployment"] = {"id": DEPLOYMENT, "status": "DEPLOYING"}
        result = self.release()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.records, [])
        self.assertEqual(self.mutations(), [])

    def test_prior_in_flight_release_blocks_then_recovered_success_rechecks_order(self):
        self.seed("v1.2.0", ["in_progress"], identifier=DEPLOYMENT)
        self.railway_states = ["DEPLOYING"]
        result = self.release("v1.3.0")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(len(self.records), 1)
        self.assertEqual(self.mutations(), [])
        self.railway_states = ["SUCCESS"]
        result = self.release("v1.1.9")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.statuses[1][0]["state"], "success")
        self.assertEqual(self.mutations(), [])

    def test_success_from_wrong_artifact_does_not_advance_release_state(self):
        self.deployed_digest = "sha256:" + "c" * 64
        result = self.release()
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(any(s["state"] == "success" for s in self.statuses[1]))

    def test_terminal_non_success_states_fail_without_rollback(self):
        for state in [
            "FAILED",
            "CRASHED",
            "NEEDS_APPROVAL",
            "SLEEPING",
            "SKIPPED",
            "REMOVED",
            "REMOVING",
            "UNKNOWN",
        ]:
            with self.subTest(state=state):
                self.records.clear()
                self.statuses.clear()
                self.requests.clear()
                self.railway_states = [state]
                self.config["services"][SERVICE]["source"] = {
                    "image": "ghcr.io/fvoulgari/lexi:v1.1.2"
                }
                result = self.release()
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(self.statuses[1][0]["state"], "failure")
                self.assertFalse(any(s["state"] == "success" for s in self.statuses[1]))
                self.assertEqual(len(self.mutations()), 2)

    def test_timeout_retains_identity_for_retry_without_duplicating_rollout(self):
        self.railway_states = ["DEPLOYING"]
        result = self.release(RELEASE_TIMEOUT="0.03", RELEASE_POLL_INTERVAL="0.005")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.statuses[1][0]["state"], "failure")
        self.railway_states = ["SUCCESS"]
        self.requests.clear()
        result = self.release()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.mutations(), [])
        self.assertEqual(len(self.records), 1)

    def test_success_record_write_failure_is_recoverable_without_redeployment(self):
        self.reject_success = True
        result = self.release()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.statuses[1][0]["state"], "in_progress")
        self.reject_success = False
        self.requests.clear()
        result = self.release()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(len(self.records), 1)
        self.assertEqual(self.mutations(), [])

    def test_graphql_error_and_wrong_deployment_id_never_count_as_success(self):
        self.api_error = "ReleaseConfigure"
        result = self.release()
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(any(s["state"] == "success" for s in self.statuses[1]))
        self.assertNotIn("test-railway-token", result.stdout + result.stderr)
        self.assertNotIn("test-github-token", result.stdout + result.stderr)
        self.api_error = None
        self.records.clear()
        self.statuses.clear()
        self.reported_id = "22222222-2222-4222-8222-222222222222"
        result = self.release()
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(any(s["state"] == "success" for s in self.statuses[1]))

    def test_nonstable_tags_and_unpinned_images_never_call_apis(self):
        for tag in ["v1.2.0-rc.1", "v1.2.0+build", "v01.2.0", "latest"]:
            self.assertNotEqual(self.release(tag).returncode, 0)
        self.assertNotEqual(
            self.release(RELEASE_IMAGE="ghcr.io/fvoulgari/lexi:latest").returncode, 0
        )
        self.assertEqual(self.requests, [])

    def test_approval_wait_and_unrecorded_source_block_new_rollouts(self):
        self.instance["latestDeployment"] = {
            "id": DEPLOYMENT,
            "status": "NEEDS_APPROVAL",
        }
        result = self.release()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.mutations(), [])
        self.instance["latestDeployment"] = None
        self.instance["source"]["image"] = "ghcr.io/fvoulgari/lexi:v9.0.0"
        result = self.release()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.mutations(), [])

    def test_waits_for_effective_config_before_creating_rollout(self):
        self.config_reads_remaining = 2
        result = self.release()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        operations = [
            body["operationName"]
            for _, path, body in self.requests
            if path == "/railway"
        ]
        deploy_at = operations.index("ReleaseDeploy")
        self.assertEqual(
            operations[operations.index("ReleaseConfigure") : deploy_at].count(
                "ReleaseConfig"
            ),
            3,
        )

    def test_config_timeout_never_starts_a_deployment(self):
        self.config_reads_remaining = 100000
        result = self.release(RELEASE_CONFIG_TIMEOUT="0.02")
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(
            any(body["operationName"] == "ReleaseDeploy" for body in self.mutations())
        )

    def test_high_water_includes_older_deployment_and_status_pages(self):
        self.seed("v10.0.0", ["inactive"] * 100 + ["success"])
        for number in range(100):
            self.seed(f"v2.0.{number}", ["success"])
        result = self.release("v3.0.0")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.mutations(), [])
        self.assertTrue(
            any(
                "page=2" in path for method, path, _ in self.requests if method == "GET"
            )
        )
