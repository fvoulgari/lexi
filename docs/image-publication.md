# Production image publication

Every push to main runs application checks and registry integration checks before
publishing the combined frontend/API production image for linux/amd64 to
`ghcr.io/fvoulgari/lexi:sha-<full-commit-sha>`. Pull requests validate the production
Docker build and promotion behavior without publishing or receiving package write
permissions. PostgreSQL and application secrets remain runtime configuration.

Each main image records its source revision and the Application checks workflow's
run number. SHA builds run independently. Only latest promotion is serialized,
using GitHub Actions' `queue: max` (up to 100 pending promotions). Older or repeated
runs leave a newer latest untouched. A registry error fails promotion rather than
being treated as a missing tag. An existing latest with missing/invalid ordering
metadata fails closed and needs maintainer investigation. Keep main publications
in the same workflow so its run-number sequence remains consistent; release
publication must not update latest or the main ordering metadata.

A promotion failure leaves the SHA image available. After resolving the failure,
rerun the failed promotion job; it checks current latest again. Queue overflow can
cancel a promotion, but cannot cancel its independently completed SHA publication.
No automatic deployment, branch protection, or image retention is configured here.

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
It does not publish to GHCR.

The PR workflow also builds the actual production Docker target. Hosted main
publication, GHCR source/platform metadata, public visibility, and an anonymous
pull must be verified after merging; PR checks cannot prove these writes.
After the first publication, inspect the image's OS/architecture and
org.opencontainers.image.revision label with `docker image inspect` and compare
its SHA with the successful main run. Application-check failure must leave both
publishing jobs skipped. Preserve hosted run links as evidence.
