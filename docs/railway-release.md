# Railway release runbook

Cloudflare Tunnel connects the public origin to the loopback listener in the Railway application service. That service serves the React build and FastAPI API on the same origin. A separate private PostgreSQL 18 service persists vocabulary, learner preferences, reviews and progress. SuperTokens Core handles authentication and sessions, with Resend HTTPS delivery for verification and reset emails. See [ADR 0001](adr/0001-railway-application-and-private-postgresql.md). Local Compose and the separate frontend/backend development builds remain supported.

## Automated releases

Main merges publish checked SHA images without deploying. Creating a canonical
stable version tag on a commit reachable from main runs checks, publishes the
immutable version image, and deploys its exact registry digest to the existing
lexi production application. GitHub Release publication and prerelease tags do not
deploy. The tagged revision must contain the deployment workflow.

An operator-created stable tag is the explicit release action. On 21 November
2026, a read-only Railway check confirmed v1.2.2 as the active production
application image. See the [post-cutover audit](legacy-schema-audit.md) for its
image digest and source revision.

### Production credential setup

The GitHub production environment allows the `v*.*.*` tag pattern, requires no
additional manual approval, and contains the environment-scoped `RAILWAY_TOKEN`
secret (verified present on 18 October 2026). The workflow independently rejects
noncanonical versions and revalidates main ancestry after waiting for production.
PR and main jobs never receive this secret or initiate a rollout.

Railway's authenticated CLI API returned `Not Authorized` for project-token
creation during setup. The operator completed the following manual credential
step; use the same procedure when rotating the token:

1. In the existing lexi project's Settings → Tokens, create a project token scoped
   to **production**, named `lexi-github-production-releases`.
2. From a terminal authenticated to GitHub, run
   `gh secret set RAILWAY_TOKEN --repo fvoulgari/lexi --env production` and paste the
   token into its hidden prompt. Do not commit it or add it to application variables.
3. Verify the secret name with
   `gh secret list --repo fvoulgari/lexi --env production`. Token values are not
   readable back from GitHub. Confirm the Railway token is scoped to project
   `de2e2c78-8a6b-41aa-afeb-c6d8002ecc79`, environment
   `c41cced0-97ff-441b-b86e-38a191a48188`, before storing it.

Do not substitute the CLI's account credential for the scoped project token.
Missing credentials fail before production mutations. GitHub access uses the job's
GITHUB_TOKEN with `deployments: write`; GHCR images remain public and Railway needs
no runtime registry credential. Railway documents the
[project-token scope and header](https://docs.railway.com/integrations/api).

### Release processing and durable state

Production jobs share a single concurrency group with cancellation disabled.
Up to 100 jobs can wait; overflow cancels/rejects a queued job and must be treated
as an uncompleted release, never success. Inspect the Actions run and rerun after
capacity recovers. The publisher's version and SHA locks remain separate.

The release command stores its durable intent and outcome in GitHub Deployments
for environment `production`, task `lexi-release`. The payload records schema 1,
version, checked SHA, and pinned image. GitHub's automatic environment deployments
use another task and are not the version ledger. Preserve these records and their
statuses: the numeric maximum of every historical successful version, plus the
v1.1.2 baseline, prevents queued older versions from deploying. Later `inactive`
statuses do not erase historical success. Records and statuses are paginated;
exceeding the bounded history scan fails closed for operator review.

A release records intent before applying any source change. Configuration is
committed with `skipDeploys=true`, changing only the application's image and
readiness settings. The command waits for effective environment configuration to
show the requested image, no public Railway health-check path, a 120-second
health-check timeout setting, and one replica; legacy
service-instance fields may differ from that effective configuration. It checks
that the existing rollout has not changed, then explicitly starts one deployment
and immediately records its exact Railway ID. No rebuild is requested on Railway.

Only that ID's `SUCCESS`, matching project/environment/service and image digest, plus the public readiness probe reporting Tunnel ingress,
advance successful-release state. Polling is bounded to 15 minutes; configuration
convergence is bounded to two minutes, within the job's 25-minute limit. Failure,
crash, timeout, approval wait, or any other non-success state fails the job. No
application rollback, migration downgrade, or database change is performed by the
release command. The application container checks its schema revision and does
not run migrations at startup.

### Reruns and failed rollout recovery

- An already successful version with the same SHA/digest is a no-op. Conflicting
  identities and versions older than the successful high-water mark are rejected.
- A rerun with a recorded Railway ID observes that same rollout; it never starts a
  duplicate. This also recovers a timeout or a failed GitHub success-status write.
- Before another version starts, interrupted earlier releases are reconciled.
  Active/approval-waiting rollouts block a new deployment. A recovered success
  advances the high-water mark before queued-version eligibility is checked.
- A deployment intent without a recorded Railway ID is ambiguous. Inspect Railway
  history around that attempt and reconcile the GitHub record with the exact ID
  before retrying. Do not blindly rerun the deployment mutation. If no rollout
  actually started, an operator must resolve that unused intent after confirming
  the source/configuration state. Never delete successful history to force a release.
- Terminal failed/crashed rollouts require operator assessment of migration/schema
  compatibility before a new release. Unexpected or unrecorded source changes also
  require reconciliation rather than silently replacing a manual deployment.

For manual application/database recovery, follow the migration and backup sections
below. A new stable tag is an explicit release; it does not imply a safe schema rollback.

## Historical setup verification (18 October 2026)

The effective production environment configuration was read back with
`/api/health`, a 120-second timeout, and `multiRegionConfig.sfo.numReplicas=1` after
a patch explicitly skipped deployments. The source remains
`ghcr.io/fvoulgari/lexi:v1.1.2`; the live deployment ID remains
`7e05f23e-0d50-4610-b5b7-036d9aece929`. PostgreSQL remains version 18 on private
networking. Runtime variables and startup commands were not changed.

GitHub production was created with the version-tag restriction and no reviewer or
timer approval. Main still requires Application checks passed with administrator
bypass and zero approving reviews. GHCR public visibility/pull and Actions package
writes have evidence in the image-publication guide. The Railway project-token
creation API was denied, so the operator created the production-scoped token
through the dashboard. The setup wizard verified its project/environment scope
before storing it. GitHub read-back confirms the production `RAILWAY_TOKEN`
secret exists (updated `2026-10-18T20:27:31Z`); its value was not read back.

Controlled HTTP APIs exercise the release command without live deployment access.
They verify image/target identity, success timing, numeric/paginated history,
convergence, busy rollouts, failure/timeout/approval states, lost-success recording,
reruns, and ambiguous attempts. This section records pre-rollout pipeline validation. See the [production authentication release record](authentication-production-release-2026-11-20.md) for later execution evidence.

Local validation passed: 35 pipeline tests (including 18 controlled release API
cases), 112 backend tests on disposable PostgreSQL 18, 204 frontend tests, lint,
compilation, frontend build, and the linux/amd64 production Docker build. Standards
and spec reviews found no code issues; the credential installation identified
during review is now complete. A regression test also covers Railway edge
filtering of the default Python user agent; the deployment client sends an
explicit application user agent. Actionlint passes with the previously documented
unsupported `queue` diagnostic excluded. No separate typechecking command exists.

## Runtime configuration

Run the production image as built from the root Dockerfile. The app and
PostgreSQL services share the same private Railway environment. The application
listener and tunnel metrics stay on loopback. The database has no public TCP
proxy. Configure the exact HTTPS `PUBLIC_ORIGIN`, secure cookies, and the
[provider settings](authentication.md) through protected service variables.

Supply the application a private `DATABASE_URL` using the restricted runtime
login. Grant the runtime only the application table operations it requires. It
must not own the schema, have DDL or role-management privileges, or read the
operator-only account directory. Keep the schema-owner connection in controlled
operator sessions. Verify both identities' effective privileges after restore
or rotation. See the [post-cutover audit](legacy-schema-audit.md) for the recorded
runtime/operator view access and the [staging restart runbook](staging-restart.md)
for resuming the retained services.

## Migrations, restarts and rollback

The production release job does not run schema migrations. After cutover
approval, freeze writers, verify a fresh independent backup, and run the reviewed
Alembic and ownership migrations from a controlled authenticated operator
session with a temporary privileged credential. Start the application using a
separate restricted runtime credential. Startup checks the schema revision and rejects unmigrated legacy cards or
Units. Readiness also checks the runtime database connection.
If a migration fails, keep writes frozen, inspect the cause and preserve any
committed schema changes before retrying or restoring to a separate target.

Application replacement/restart retains the separate PostgreSQL volume and all saved records. No durable data belongs on the application filesystem. Unsubmitted cards and a revealed answer are intentionally not recovered after reload. Device preferences can be restored independently of application records.

For a failed application release, redeploy the previous known-good image if compatible with the current schema. Do not automatically downgrade Alembic: older practice-table downgrades delete history. For an incompatible schema, stop writes and plan recovery from the verified pre-release backup with an operator; restore to a replacement database first, validate it, then switch the private connection reference. Retain the old database until recovery is accepted.

## Backups

PostgreSQL volume backups are opt-in. In the PostgreSQL service's **Backups** tab, enable **Daily**, verify the first backup completes, and check subsequent completion dates. Confirm the available retention and the latest recoverable point for the selected service. Take a manual volume snapshot before a risky migration. Volume snapshots remain tied to that service/project/environment; deleting the volume also deletes its backups. Keep protected logical dumps separately. See [Railway volume backups](https://docs.railway.com/volumes/backups) and [the PostgreSQL restore guide](https://docs.railway.com/guides/postgres-backups-restores).

For a manual logical backup, run PostgreSQL 18 client tools in a maintenance container or PostgreSQL container on the same private network. The application image does not include `pg_dump`. Supply libpq `PGHOST`, `PGPORT`, `PGUSER`, `PGDATABASE` and `PGPASSWORD` through protected environment variables; do not put a password on the command line. Use the same PostgreSQL major version as the server (or a supported newer dump client). Store dumps with restricted access, encryption and offsite retention.

```sh
umask 077
pg_dump --format=custom --no-owner --no-acl --file=notebook.dump
# On the private PostgreSQL connection; the target must not already exist.
createdb notebook_restore
pg_restore --dbname=notebook_restore --no-owner --no-acl \
  --exit-on-error notebook.dump
```

`createdb` uses the same connection host/user; the restore role needs database-creation permission. Restore into a **new disposable database**, never over the source. Point a separate application instance at that private database, with its own matching `PUBLIC_ORIGIN`, run migrations, then verify account ownership, Collections, card IDs, both learning directions, summaries and progress through the API. Verify provider session and revocation behavior before admitting learners to a recovered live service. A volume-snapshot restore is a separate operation: stop writes, review the staged restored volume and data-loss cutoff, deploy the staged change, verify readiness and records, and only then reopen writes.

For local Compose, the tools already exist inside the private PostgreSQL service:

```sh
umask 077
docker compose exec -T postgres pg_dump -U notebook -d notebook \
  -Fc --no-owner --no-acl > notebook.dump
docker compose exec -T postgres createdb -U notebook notebook_restore
docker compose exec -T postgres pg_restore -U notebook -d notebook_restore \
  --no-owner --no-acl --exit-on-error < notebook.dump
```

`docker compose down` keeps the named volume. `down -v` destroys it. Do not expose PostgreSQL publicly to run maintenance.

## Historical shared-gate persistence and restore drill

The commands below record the earlier release rehearsal. Use a compatible historical image to reproduce it. For current recovery, use the isolated restore procedure above and the current sign-in flow.

Use a fresh private Docker network, PostgreSQL 18 container and database, with a localhost-only test port if needed. Run the production image on that network, supply disposable secrets, `COOKIE_SECURE=false`, and `PUBLIC_ORIGIN=http://localhost:8801`; publish only `127.0.0.1:8801:8000`. Seed once. In the following commands, the PostgreSQL container is `lexi-release-postgres`, the application is `lexi-release-app`, and the source database is `lexi_release`.

```sh
# SHARED_PASSWORD must already be in this shell's environment.
SMOKE_BASE_URL=http://localhost:8801 python3 scripts/smoke.py \
  --write-disposable /tmp/lexi-release-evidence.json
docker restart lexi-release-app
# Wait for /api/health to return 200, then:
SMOKE_BASE_URL=http://localhost:8801 python3 scripts/smoke.py \
  --verify /tmp/lexi-release-evidence.json
umask 077
docker exec lexi-release-postgres pg_dump -U postgres -d lexi_release \
  -Fc --no-owner --no-acl > /tmp/lexi-release.dump
docker exec lexi-release-postgres createdb -U postgres lexi_restore
docker exec -i lexi-release-postgres pg_restore -U postgres -d lexi_restore \
  --no-owner --no-acl --exit-on-error < /tmp/lexi-release.dump
```

Start a second application container using `lexi_restore` on the same network, port `127.0.0.1:8802:8000`, and `PUBLIC_ORIGIN=http://localhost:8802`. Wait for health, then:

```sh
SMOKE_BASE_URL=http://localhost:8802 python3 scripts/smoke.py \
  --verify /tmp/lexi-release-evidence.json
```

The evidence compares imported vocabulary, both direction totals, full progress and session summaries through HTTP after restart and restore. Write mode creates a uniquely named learner and two meanings, and saves one review in each direction. It does not clean up those reviewed meanings; discard the disposable environment afterward. Evidence files contain learner data, are created with owner-only permissions and must not be committed. Use a new evidence filename for each drill. Default smoke mode performs no library or practice writes; it creates and revokes a temporary gate session.

## Historical release evidence and limitations

See [the release verification record](release-verification.md) for executed checks, the screen audit and remaining operator checks. Device installation differs between browsers; real iOS/Android installation and Railway edge behavior require verification in those environments. Continuous monitoring, point-in-time recovery, automated offsite logical dumps, individual authentication, multi-replica migration coordination and offline private practice remain deferred improvements.

## Historical release publication failure on v1.1.3

The first v1.1.3 tag run passed checks but stopped before deployment: the Docker
runner converted the SHA image's OCI manifest to Docker format while retagging,
changing the digest although config and layer identities were unchanged. The
publisher now copies registry manifests by digest with
`docker buildx imagetools create --prefer-index=false` and still requires exact
digest equality. This also preserves indexes and missing-SHA recovery.

The already published v1.1.3 image remains immutable. Do not move that Git tag or
overwrite the image. Merge the fix and use a new stable version (v1.1.4 or higher).
Rerunning v1.1.3 uses its original script and cannot pick up this fix. Deployment
was skipped for that failed run; no successful-release state was advanced.
