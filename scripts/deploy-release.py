#!/usr/bin/env python3
"""Deploy one verified release digest; GitHub records preserve rollout identity."""

import json
import os
import re
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlencode, urlparse
from urllib.request import Request, urlopen
from uuid import UUID

PROJECT = "de2e2c78-8a6b-41aa-afeb-c6d8002ecc79"
ENVIRONMENT = "c41cced0-97ff-441b-b86e-38a191a48188"
SERVICE = "bbd1f305-9f32-4f08-af21-3e1a5f621265"
REPOSITORY = "fvoulgari/lexi"
DEPLOYMENTS = f"/repos/{REPOSITORY}/deployments"
BASELINE = (1, 1, 2)
PENDING = {"QUEUED", "INITIALIZING", "WAITING", "BUILDING", "DEPLOYING"}
FAILED = {"FAILED", "CRASHED"}
INSTANCE_QUERY = """query ReleaseInstance($environmentId: String!, $serviceId: String!) {
  serviceInstance(environmentId: $environmentId, serviceId: $serviceId) {
    serviceId environmentId source { image repo }
    healthcheckPath healthcheckTimeout numReplicas
    latestDeployment { id status }
  }
}"""
CONFIG_QUERY = """query ReleaseConfig($environmentId: String!) {
  environment(id: $environmentId) { config }
}"""
CONFIGURE_QUERY = """mutation ReleaseConfigure(
  $environmentId: String!, $patch: EnvironmentConfig!, $skipDeploys: Boolean!
) {
  environmentPatchCommit(environmentId: $environmentId, patch: $patch,
    skipDeploys: $skipDeploys, commitMessage: "Configure checked release image")
}"""
DEPLOY_QUERY = """mutation ReleaseDeploy($environmentId: String!, $serviceId: String!) {
  serviceInstanceDeployV2(environmentId: $environmentId, serviceId: $serviceId)
}"""
STATUS_QUERY = """query ReleaseStatus($id: String!) {
  deployment(id: $id) { id status projectId environmentId serviceId meta }
}"""


class ReleaseError(Exception):
    pass


def request(url, headers, body=None):
    data = None if body is None else json.dumps(body).encode()
    req = Request(
        url,
        data=data,
        headers={
            "Content-Type": "application/json",
            "User-Agent": "lexi-release-deployment/1.0",
            **headers,
        }
    )
    with urlopen(req, timeout=30) as response:
        return json.load(response)


def github(path, body=None):
    return request(
        os.environ.get("GITHUB_API_URL", "https://api.github.com") + path,
        {
            "Authorization": "Bearer " + os.environ["GH_TOKEN"],
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        },
        body,
    )


def railway(query, variables):
    name = re.search(r"(?:query|mutation) (\w+)", query).group(1)
    result = request(
        os.environ.get("RAILWAY_API_URL", "https://backboard.railway.com/graphql/v2"),
        {"Project-Access-Token": os.environ["RAILWAY_TOKEN"]},
        {"query": query, "operationName": name, "variables": variables},
    )
    if result.get("errors") or not result.get("data"):
        raise ReleaseError(
            f"Railway rejected {name}; inspect the API/deployment state."
        )
    return result["data"]


def version(tag):
    if len(tag) > 128 or not re.fullmatch(
        r"v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)", tag
    ):
        raise ReleaseError(
            "Only canonical stable vMAJOR.MINOR.PATCH releases can deploy."
        )
    return tuple(map(int, tag[1:].split(".")))


def deployment_url(identifier):
    return f"https://railway.com/project/{PROJECT}/service/{SERVICE}?" + urlencode(
        {"environmentId": ENVIRONMENT, "deploymentId": identifier}
    )


def status(record, state, identifier=None):
    body = {
        "state": state,
        "auto_inactive": False,
        "description": "Railway release " + state,
    }
    if identifier:
        body["log_url"] = deployment_url(identifier)
    github(f"{DEPLOYMENTS}/{record['id']}/statuses", body)


def pages(path):
    separator = "&" if "?" in path else "?"
    for page in range(1, 101):
        batch = github(f"{path}{separator}per_page=100&page={page}")
        if not isinstance(batch, list):
            raise ReleaseError("Invalid GitHub deployment history.")
        yield from batch
        if len(batch) < 100:
            return
    raise ReleaseError(
        "Deployment history exceeds the bounded scan; manual review required."
    )


def history():
    result = []
    for record in pages(DEPLOYMENTS + "?task=lexi-release&environment=production"):
        payload = record["payload"]
        if payload.get("schema") != 1:
            raise ReleaseError(
                "Unknown release history schema; refusing to guess version state."
            )
        states = list(pages(f"{DEPLOYMENTS}/{record['id']}/statuses"))
        result.append((record, states, version(payload["version"])))
    return result


def recorded_id(states):
    for state in states:
        if state.get("log_url"):
            url = urlparse(state["log_url"])
            params = parse_qs(url.query)
            if (
                url.scheme != "https"
                or url.netloc != "railway.com"
                or url.path != f"/project/{PROJECT}/service/{SERVICE}"
                or params.get("environmentId") != [ENVIRONMENT]
            ):
                raise ReleaseError(
                    "Deployment record has an unexpected Railway target."
                )
            return str(UUID(params["deploymentId"][0]))
    return None


def railway_state(identifier):
    identifier = str(UUID(identifier))
    deployment = railway(STATUS_QUERY, {"id": identifier})["deployment"]
    if (
        deployment["id"] != identifier
        or deployment["projectId"] != PROJECT
        or deployment["environmentId"] != ENVIRONMENT
        or deployment["serviceId"] != SERVICE
    ):
        raise ReleaseError("Railway returned a different deployment target.")
    return deployment


def verify_artifact(deployment, image):
    meta = deployment.get("meta") or {}
    if meta.get("image") != image or meta.get("imageDigest") != image.split("@")[1]:
        raise ReleaseError(
            "Ready deployment does not match the verified release digest."
        )


def wait_for(record, identifier, tag, image):
    deadline = time.monotonic() + float(os.environ.get("RELEASE_TIMEOUT", "900"))
    while time.monotonic() < deadline:
        deployment = railway_state(identifier)
        if deployment["status"] == "SUCCESS":
            verify_artifact(deployment, image)
            status(record, "success", identifier)
            print(f"Release {tag} succeeded: {image} ({identifier})")
            return
        if deployment["status"] not in PENDING:
            status(record, "failure", identifier)
            raise ReleaseError(
                f"Railway deployment is {deployment['status']}; manual recovery required."
            )
        time.sleep(float(os.environ.get("RELEASE_POLL_INTERVAL", "10")))
    status(record, "failure", identifier)
    raise ReleaseError(
        "Railway readiness timed out; inspect the recorded rollout before recovery."
    )


def app_config():
    config = railway(CONFIG_QUERY, {"environmentId": ENVIRONMENT})["environment"][
        "config"
    ]
    if isinstance(config, str):
        config = json.loads(config)
    return config["services"][SERVICE]


def await_configuration(image):
    deadline = time.monotonic() + float(os.environ.get("RELEASE_CONFIG_TIMEOUT", "120"))
    while time.monotonic() < deadline:
        app = app_config()
        deploy = app["deploy"]
        regions = deploy.get("multiRegionConfig") or {}
        replicas = (
            sum(region["numReplicas"] for region in regions.values())
            if regions
            else deploy.get("numReplicas")
        )
        if (
            app["source"].get("image") == image
            and not app["source"].get("repo")
            and deploy.get("healthcheckPath") == "/api/health"
            and deploy.get("healthcheckTimeout") == 120
            and replicas == 1
        ):
            return
        time.sleep(float(os.environ.get("RELEASE_POLL_INTERVAL", "10")))
    raise ReleaseError(
        "Effective Railway config did not converge; no rollout was requested."
    )


def main():
    tag = os.environ["RELEASE_TAG"]
    if version(tag) <= BASELINE:
        raise ReleaseError(
            "Release must advance beyond the v1.1.2 production baseline."
        )
    sha = os.environ["SOURCE_SHA"]
    image = os.environ["RELEASE_IMAGE"]
    if not re.fullmatch(r"[0-9a-f]{40}", sha):
        raise ReleaseError("Invalid checked source SHA.")
    if not re.fullmatch(r"ghcr.io/fvoulgari/lexi@sha256:[0-9a-f]{64}", image):
        raise ReleaseError("Release image must be a verified lexi registry digest.")
    if not os.environ.get("GH_TOKEN") or not os.environ.get("RAILWAY_TOKEN"):
        raise ReleaseError("Production deployment credentials are missing.")
    previous = history()
    high_water = max(
        [BASELINE]
        + [
            v
            for _, states, v in previous
            if any(s["state"] == "success" for s in states)
        ]
    )
    if version(tag) < high_water:
        raise ReleaseError(
            "Release is older than the last successful production version."
        )
    for record, states, _ in previous:
        if record["payload"]["version"] == tag:
            if record["payload"]["sha"] != sha or record["payload"]["image"] != image:
                raise ReleaseError(
                    "Release identity conflicts with its durable deployment record."
                )
            if any(s["state"] == "success" for s in states):
                print(f"Release {tag} already succeeded; leaving production unchanged.")
                return
    # Reconcile interrupted runs before touching the service or trusting version order.
    for record, states, deployed_version in previous:
        if any(s["state"] == "success" for s in states):
            continue
        identifier = recorded_id(states)
        if not identifier:
            raise ReleaseError(
                "Uncertain release attempt without a Railway ID; manual inspection required."
            )
        if record["payload"]["version"] == tag:
            wait_for(record, identifier, tag, image)
            return
        deployment = railway_state(identifier)
        if deployment["status"] in PENDING:
            raise ReleaseError(
                "Another recorded Railway rollout is still active; retry after recovery."
            )
        if deployment["status"] == "SUCCESS":
            verify_artifact(deployment, record["payload"]["image"])
            status(record, "success", identifier)
            if version(tag) <= deployed_version:
                raise ReleaseError(
                    "A recovered successful release supersedes this version."
                )
        elif deployment["status"] not in FAILED:
            raise ReleaseError(
                "Prior rollout requires manual recovery before another release."
            )
    scope = {"environmentId": ENVIRONMENT, "serviceId": SERVICE}
    instance = railway(INSTANCE_QUERY, scope)["serviceInstance"]
    if (
        instance["serviceId"] != SERVICE
        or instance["environmentId"] != ENVIRONMENT
        or instance["source"].get("repo")
    ):
        raise ReleaseError(
            "Railway application target/source does not match production."
        )
    if instance.get("latestDeployment") and instance["latestDeployment"][
        "status"
    ] not in FAILED | {"SUCCESS"}:
        raise ReleaseError(
            "Railway already has an active rollout; refusing to overlap migrations."
        )
    known_images = {"ghcr.io/fvoulgari/lexi:v1.1.2"} | {
        record["payload"]["image"] for record, _, _ in previous
    }
    if (
        instance["source"]["image"] not in known_images
        or app_config()["source"]["image"] not in known_images
    ):
        raise ReleaseError(
            "Production source changed outside recorded releases; reconcile it manually."
        )
    record = github(
        DEPLOYMENTS,
        {
            "ref": sha,
            "task": "lexi-release",
            "environment": "production",
            "auto_merge": False,
            "required_contexts": [],
            "production_environment": True,
            "payload": {"version": tag, "sha": sha, "image": image, "schema": 1},
        },
    )
    status(record, "queued")
    patch = {
        "services": {
            SERVICE: {
                "source": {"image": image},
                "deploy": {
                    "healthcheckPath": "/api/health",
                    "healthcheckTimeout": 120,
                    "numReplicas": 1,
                },
            }
        }
    }
    railway(
        CONFIGURE_QUERY,
        {"environmentId": ENVIRONMENT, "patch": patch, "skipDeploys": True},
    )
    await_configuration(image)
    current = railway(INSTANCE_QUERY, scope)["serviceInstance"]
    if current["latestDeployment"] != instance["latestDeployment"]:
        raise ReleaseError(
            "Railway rollout changed during configuration; inspect before retrying."
        )
    identifier = str(UUID(railway(DEPLOY_QUERY, scope)["serviceInstanceDeployV2"]))
    status(record, "in_progress", identifier)
    wait_for(record, identifier, tag, image)


if __name__ == "__main__":
    try:
        main()
    except ReleaseError as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
    except (HTTPError, URLError, TimeoutError, KeyError, ValueError) as error:
        print(
            f"Release API/configuration error ({type(error).__name__}); "
            "inspect existing deployment records before retrying.",
            file=sys.stderr,
        )
        sys.exit(1)
