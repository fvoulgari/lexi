# Railway release runbook

One application service serves the React build and FastAPI API on the same origin. A separate PostgreSQL service owns all durable vocabulary, learner preferences, gate sessions, review events and learning records. See [ADR 0001](adr/0001-railway-application-and-private-postgresql.md). Local Compose and the separate frontend/backend development builds remain supported.

## Prepare and deploy

Actual production deployment requires separate authorization. The following is the operator procedure after that authorization.

1. Build and verify the root image with `docker build -t italian-notebook .`. Select the repository root, root `Dockerfile` for the application service. Do not select the development Dockerfiles. The final image runs as `notebook`, contains no Node runtime, and serves the compiled frontend directly.
2. Add PostgreSQL in the same Railway project **and environment**, with its persistent volume. Retain private networking and remove any public TCP proxy. Set application `DATABASE_URL` to a reference such as `${{Postgres.DATABASE_URL}}` (replace `Postgres` with the actual service name); verify the resolved hostname ends in `.railway.internal`. Do not use `DATABASE_PUBLIC_URL`. The app accepts `postgresql://` and `postgres://` URLs and uses psycopg. Private DNS is available at runtime, so migrations run at startup rather than during image build. See [Railway private networking](https://docs.railway.com/networking/private-networking).
3. Generate independent `SHARED_PASSWORD` (12–256 characters) and `SESSION_SECRET` (32–256 characters). Keep both and `DATABASE_URL` in service variables, never frontend variables, build arguments, Git or logs. `python3 -c "import secrets; print(secrets.token_urlsafe(48))"` generates a suitable secret.
4. Generate the application HTTPS domain. Set `PUBLIC_ORIGIN` to that exact origin, without a trailing slash or path, and `COOKIE_SECURE=true`. Railway sets `PORT`; the start script binds `0.0.0.0:$PORT`. Do not override the image start command.
5. In the application service settings, set the health-check path to `/api/health`, health-check timeout to 120 seconds, restart policy to On Failure with 10 retries, and replicas to one. The endpoint checks a real PostgreSQL connection and returns 503 on database failure. Railway health checks gate deployment readiness, not continuous production monitoring; arrange an external uptime check separately. See [Railway health checks](https://docs.railway.com/deployments/healthchecks).
6. Inspect migration/startup logs and health. Run `python -m app.seed` once in the application container using Railway SSH, or a one-off container on the same private network with the same environment. `railway run` on a laptop does not join the private network. Seeding is explicit and idempotent for initial identities; it is not a reset operation.
7. Run the read-only smoke check from an operator machine with the shared password supplied securely in its environment: `SMOKE_BASE_URL=https://your-domain python3 scripts/smoke.py`. Sign in in a browser and complete the gate → CSV preview/confirm → practice in both directions → Progress journey. The write-enabled smoke mode is only for a disposable staging database.

## HTTPS, cookies and proxies

Railway terminates HTTPS and forwards HTTP to Uvicorn. Browser requests are same-origin `/api` requests; no production CORS or separate frontend service is needed. `PUBLIC_ORIGIN` validates write origins even though the internal hop is HTTP. Production cookies are Secure, HttpOnly and SameSite=Strict; the signed CSRF header is required for login and all writes. Local HTTP needs `COOKIE_SECURE=false` and an exact local `PUBLIC_ORIGIN`.

`FORWARDED_ALLOW_IPS` defaults to `127.0.0.1` in the start script. Set it only to verified trusted proxy IPs/networks. Do not blindly use `*`: other callers must not be able to spoof client IPs through forwarded headers. With no trusted Railway proxy configured, login throttling groups users by the connecting proxy address (five attempts per minute). This can block the whole small group after failed passwords; verify proxy trust in the deployment environment before enabling per-client forwarded IPs. The app does not derive cookie security or CSRF origin from forwarded headers.

Lock notebook revokes the PostgreSQL session and clears in-memory private query data. Rotate `SESSION_SECRET` when changing `SHARED_PASSWORD` to invalidate existing sessions. Learner profiles are shared identities, not authenticated private accounts.

## Migrations, restarts and rollback

Every start runs `alembic upgrade head` before Uvicorn. A migration failure stops startup and prevents readiness. Keep a single application replica for this release; concurrent startup migrations have no advisory-lock coordination. Back up before upgrading, test migrations against a restored disposable copy, and inspect `alembic current` in the application container afterward.

Application replacement/restart retains the separate PostgreSQL volume and all saved records. No durable data belongs on the application filesystem. Unsubmitted cards and a revealed answer are intentionally not recovered after reload. Device storage contains only interface language, motion and selected learner ID.

For a failed application release, redeploy the previous known-good image if compatible with the current schema. This release adds no database migration. Do not automatically downgrade Alembic: older practice-table downgrades delete history. For an incompatible schema, stop writes and plan recovery from the verified pre-release backup with an operator; restore to a replacement database first, validate it, then switch the private connection reference. Retain the old database until recovery is accepted.

## Backups

PostgreSQL volume backups are opt-in. In the PostgreSQL service's **Backups** tab, enable **Daily**, verify the first backup completes, and check subsequent completion dates. Daily backups are retained for six days, so up to a day's changes may be lost. Take a manual volume snapshot before a risky migration. Volume snapshots remain tied to that service/project/environment; deleting the volume also deletes its backups. Keep protected logical dumps separately. See [Railway volume backups](https://docs.railway.com/volumes/backups) and [the PostgreSQL restore guide](https://docs.railway.com/guides/postgres-backups-restores).

For a manual logical backup, run PostgreSQL 17 client tools in a maintenance container or PostgreSQL container on the same private network. The application image does not include `pg_dump`. Supply libpq `PGHOST`, `PGPORT`, `PGUSER`, `PGDATABASE` and `PGPASSWORD` through protected environment variables; do not put a password on the command line. Use the same PostgreSQL major version as the server (or a supported newer dump client). Store dumps with restricted access, encryption and offsite retention.

```sh
umask 077
pg_dump --format=custom --no-owner --no-acl --file=notebook.dump
# On the private PostgreSQL connection; the target must not already exist.
createdb notebook_restore
pg_restore --dbname=notebook_restore --no-owner --no-acl \
  --exit-on-error notebook.dump
```

`createdb` uses the same connection host/user; the restore role needs database-creation permission. Restore into a **new disposable database**, never over the source. Point a separate application instance at that private database, with its own matching `PUBLIC_ORIGIN`, run migrations, then verify vocabulary, tags/units, both learning directions, summaries and progress through the public API. Rotate session secrets before admitting learners to a recovered live service. A volume-snapshot restore is a separate operation: stop writes, review the staged restored volume and data-loss cutoff, deploy the staged change, verify readiness and records, and only then reopen writes.

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

## Repeat the connected persistence and restore drill

Use a fresh private Docker network, PostgreSQL 17 container and database, with a localhost-only test port if needed. Run the production image on that network, supply disposable secrets, `COOKIE_SECURE=false`, and `PUBLIC_ORIGIN=http://localhost:8801`; publish only `127.0.0.1:8801:8000`. Seed once. In the following commands, the PostgreSQL container is `lexi-release-postgres`, the application is `lexi-release-app`, and the source database is `lexi_release`.

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

## Release evidence and limitations

See [the release verification record](release-verification.md) for executed checks, the screen audit and remaining operator checks. Device installation differs between browsers; real iOS/Android installation and Railway edge behavior require verification in those environments. Continuous monitoring, point-in-time recovery, automated offsite logical dumps, individual authentication, multi-replica migration coordination and offline private practice remain deferred improvements.
