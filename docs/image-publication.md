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
No automatic deployment, branch protection, or image retention is configured here.

## Release publication

Publishing a GitHub Release or prerelease triggers the same application checks
against the explicitly resolved tag commit, including annotated tags. Draft
creation and tag pushes alone do not publish release images. The release job
publishes the exact release tag and `sha-<full-commit-sha>` for linux/amd64, and
never updates latest. Application-check failures prevent publication.

If a matching SHA image already exists, the release tag references that image
without rebuilding or replacing its main ordering labels. If absent, the release
job builds the production Docker target from the tagged checkout and publishes
both tags. Existing SHA images with incorrect revision/platform metadata, or
registry errors other than a missing manifest, fail publication.

Release Git tags must also be valid Docker image tags (up to 128 characters,
letters/digits/underscore first, followed by letters/digits/underscore/dot/hyphen).
`latest` and `sha-*` are reserved. Incompatible tags fail rather than being renamed,
so exact release-tag identity and the latest/SHA namespaces remain intact.

GitHub uses the workflow stored at the release tag's revision. Release tags must
therefore contain this release-enabled workflow; publishing a release from a tag
that predates it cannot trigger this automation. This also applies to older
workflow revisions. No release or tag is created by this workflow.

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
Release coverage also publishes stable/prerelease tags to the disposable registry,
verifies both tags identify the source commit, preserves an existing main SHA
image and latest, resolves lightweight/annotated tags on an older commit, and
rejects reserved/incompatible names. It does not publish to GHCR.

The PR workflow also builds the actual production Docker target. Hosted main
publication, GHCR source/platform metadata, public visibility, and an anonymous
pull must be verified after merging; PR checks cannot prove these writes.
After the first publication, inspect the image's OS/architecture and
org.opencontainers.image.revision label with `docker image inspect` and compare
its SHA with the successful main run. Application-check failure must leave both
publishing jobs skipped. Preserve hosted run links as evidence.

For hosted release verification after merging, publish an authorized stable release
and prerelease from revisions containing the workflow. Record the run links,
confirm checks use the resolved tag commit, inspect release/SHA image revision
labels and linux/amd64 platform, and compare the latest digest before/after. A
release with failing checks must skip release publication. Include a release from
an older supported revision and overlap with main publication. These event and
GHCR-write checks require real releases and are not established by PR validation.
