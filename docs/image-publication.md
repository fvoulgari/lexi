# Production image publication

Every push to main runs application checks and registry integration checks before
publishing the combined frontend/API production image for linux/amd64 to
`ghcr.io/fvoulgari/lexi:sha-<full-commit-sha>`. Pull requests validate the production
Docker build and promotion behavior without publishing or receiving package write
permissions. PostgreSQL and application secrets remain runtime configuration.

Each main image records its source revision and the Application checks workflow's
run number. SHA builds for different commits run independently. SHA writes for the same
commit are serialized across main and release publishers, preventing releases
from replacing main ordering metadata. Latest promotion is serialized separately,
using GitHub Actions' `queue: max` (up to 100 pending promotions). Older or repeated
runs leave a newer latest untouched. A registry error fails promotion rather than
being treated as a missing tag. An existing latest with missing/invalid ordering
metadata fails closed and needs maintainer investigation. Keep main publications
in the same workflow so its run-number sequence remains consistent; release
publication must not update latest or the main ordering metadata.

A promotion failure leaves the SHA image available. After resolving the failure,
rerun the failed promotion job; it checks current latest again. Queue overflow can
cancel a promotion, but cannot cancel its independently completed SHA publication.
The required **Application checks passed** merge gate includes backend checks,
frontend checks, and image publication validation (registry integration tests plus
the production Docker build on PRs). Failed, cancelled, or skipped validation fails
the gate. Main protection requires PRs and this check for ordinary merges, with
administrator bypass and no mandatory reviewer approval. No automatic deployment
or image retention is configured here.

## Stable release publication

Creating a Git tag matching canonical stable `vMAJOR.MINOR.PATCH` triggers release
validation. Each numeric component is zero or a positive integer without leading
zeroes, and the entire name must fit Docker's 128-character tag limit. The workflow
uses a broad `v*.*.*` event filter, then ignores prerelease/build suffixes and other
noncanonical names before running checks or requesting package write permissions.
Publishing a GitHub Release is no longer a trigger.

Lightweight and annotated tags resolve to an exact commit. That commit must be
reachable from freshly fetched `origin/main`, and the tag must still match the
triggering event's commit. Backend, frontend, and publication checks run against
that resolved revision. Before publishing, main and the tag are fetched again and
identity/ancestry are revalidated. Failed, cancelled, or skipped validations prevent
publication. PRs and main pushes cannot enter release publication.

Release publication provides the exact version and `sha-<full-commit-sha>` tags for
linux/amd64 and never changes latest. A valid existing SHA image is reused without
changing its main ordering metadata. If no SHA image exists, build and load the
combined production target from the checked source, then push it. If the version
image already exists but its SHA tag is missing, restore the SHA tag from that
image without rebuilding.

A successful run exposes `digest` and `image` job outputs, where `image` is
`ghcr.io/fvoulgari/lexi@sha256:<digest>`. These identify the verified registry
manifest, not the local image config ID. Ticket #44 consumes this contract to add
Railway deployment; this ticket does not deploy.

### Version identity and concurrency

The published version image retains its source revision as a durable record.
Reruns validate revision, platform, and exact manifest identity. An existing
version with different metadata or a different digest from its SHA image is an
error; it is never overwritten. Registry errors other than an explicitly missing
manifest fail closed. Retain released version images; deleting them removes this
registry-side identity record.

The active [Immutable release tags ruleset](https://github.com/fvoulgari/lexi/rules/25355750)
blocks updates and deletion of `v*.*.*` Git tags, with no bypass actors, while
allowing new tag creation. Prerelease/build suffixes are excluded using
`refs/tags/*-*` and `refs/tags/*+*`; the workflow still performs strict canonical
version validation because GitHub's glob is broader than SemVer. This preserves
the Git version-to-commit record even if registry tags are removed. Never move or
recreate a release tag; create a new version instead.

Whole-workflow concurrency serializes events/reruns for the same version. The
release publisher also shares the existing per-SHA job concurrency group with
main publication. Other main/PR runs retain independent workflow groups, and
latest retains its separate ordering guard. Each queue permits up to 100 pending
runs/jobs; overflow fails or cancels a queued run and must not be treated as a
successful publication. Investigate the run status and rerun after resolving
capacity or registry errors.

GitHub loads the workflow from the tagged revision. Release tags must therefore
contain this stable-tag-enabled workflow. Tags on revisions predating this change
cannot activate the new automation. No release or tag is created by the workflow.

## One-time public package setup

GHCR initially creates packages as private. After the first main publication:

1. Open the lexi package under the fvoulgari GitHub profile's Packages tab.
2. In Package settings, change visibility to Public. Check that the linked lexi
   repository has Actions access to write the package.
3. Verify without saved registry credentials:

   ```sh
   publication_docker_config=$(mktemp -d)
   DOCKER_CONFIG="$publication_docker_config" docker pull --platform linux/amd64 ghcr.io/fvoulgari/lexi:latest
   rmdir "$publication_docker_config"
   ```

Public visibility permits anonymous pulls; writers still need package write
permission. The publishing jobs use GITHUB_TOKEN; no personal token is required.

## Verification

Run `python3 -m unittest discover -s scripts/tests -v` with Docker available.
The harness creates and removes a disposable registry on port 5058 (override with
TEST_REGISTRY_PORT). It publishes real linux/amd64 images and verifies first
publication, reversed completion order, repeated/older promotion attempts,
availability of every SHA image, and refusal to proceed on registry failure.
Release coverage publishes stable versions to the disposable registry and tests
lightweight/annotated resolution, invalid version exclusion, main ancestry,
changed/recreated tags, SHA reuse/recovery, wrong revision/platform metadata,
digest conflicts, safe reruns, registry failure, and preservation of latest and
main ordering labels. Exported digest outputs are compared against the registry's
HTTP manifest digest header. It does not publish to GHCR.

The PR workflow also builds the actual production Docker target. Hosted main
publication, GHCR source/platform metadata, public visibility, and an anonymous
pull must be verified after merging; PR checks cannot prove these writes.
After the first publication, inspect the image's OS/architecture and
org.opencontainers.image.revision label with `docker image inspect` and compare
its SHA with the successful main run. Application-check failure must leave both
publishing jobs skipped. Preserve hosted run links as evidence.

For hosted release verification after merging, wait for the operator's next
stable release tag on a revision containing this workflow. Record the run link,
confirm the resolved source and exported digest, compare version/SHA identities,
and confirm latest is unchanged. Nonstable tag events must skip publication;
failed checks must block it. Local Git/registry tests establish the negative cases
without creating remote tags or performing production writes. Hosted event routing
and new publisher writes remain to be verified on that authorized release.

## Stable-release setup verification (18 October 2026)

- GitHub reports the lexi package as Public, linked to fvoulgari/lexi, on its
  [public package page](https://github.com/fvoulgari/lexi/pkgs/container/lexi).
- A manifest read and complete linux/amd64 pull of v1.1.2 succeeded using a
  short-lived GHCR token issued anonymously, without account credentials. The
  temporary Docker configuration was removed. Direct token acquisition through
  Docker failed in this local environment; requesting the anonymous token through
  the host and passing it to Docker verified the pull without changing visibility.
- Pulled digest: `sha256:795553ab729a438d7824b1186e39bc3adb894d2beeb310ca05fb1afa93736d14`.
- Repository Actions write access has hosted evidence: the
  [successful main publication run](https://github.com/fvoulgari/lexi/actions/runs/39148931198)
  published its SHA image and promoted latest. Publishers continue to request
  `packages: write` through GITHUB_TOKEN; no personal or runtime pull token is added.
- The package settings API was unavailable to the local GitHub token because it
  lacks read:packages; public visibility was verified independently above.
- The immutable Git-tag ruleset was created and read back as active, targeting
  `refs/tags/v*.*.*`, excluding prerelease/build suffixes, with update/deletion
  rules and no bypass actors.
- Final local verification passed: 17 gate/Git/registry integration tests,
  112 backend tests against PostgreSQL 18, 204 frontend tests, lint/compilation,
  frontend build, and the linux/amd64 production Docker build. The affected registry
  test also passed after consolidating duplicated fixtures during review.
- Actionlint passed with its unsupported `queue` diagnostic excluded, as described
  below. There is no separate typechecking command in this JavaScript/Python repo.
- Standards and spec reviews found no remaining issues after the fixture cleanup.
- No real release tag, GHCR write, or Railway deployment was performed to test #43.

## Merge-gate verification (18 October 2026)

GitHub's main branch protection was configured and read back for ticket #42:

- Required check: `Application checks passed`, bound to the GitHub Actions app.
- The PR branch must be up to date before merging.
- Pull requests are required, with zero required approving reviews.
- Administrator enforcement is disabled, retaining administrator bypass.

Inspect the live [main protection settings](https://github.com/fvoulgari/lexi/settings/branches)
when changing required check names. Protection already requires the existing check
name; its expanded validation takes effect when this workflow change is merged.
Local gate tests execute the same command as the aggregate job and verify that only
all-success inputs pass; failure, cancellation, skip, missing/empty, and unknown
results fail closed. Registry integration tests and the production Docker build
verify image behavior separately.

Local verification passed: 112 backend tests against a separate PostgreSQL 18
container, 204 frontend tests, seven gate/registry/source tests, backend/frontend
lint and compilation, and the linux/amd64 production Docker build. This project
uses JavaScript and Python and has no separate typechecking command.

Actionlint v1.7.12 passed with only its unsupported `queue` syntax diagnostic
excluded. The three existing `queue: max` declarations were preserved; GitHub
[documents this concurrency option](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax).

Hosted verification remains: on a PR containing this change, confirm the aggregate
job waits for image validation and fails when any required validation fails or is
skipped. Confirm a passing PR can merge without reviewer approval, and that its
main run publishes a SHA image and promotes latest without deploying Railway.
Record hosted run links after those events; local tests and protection read-back
do not prove hosted event routing or GHCR writes. No release tag or production
rollout is needed for this ticket.
