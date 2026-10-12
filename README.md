# Italian Notebook

A calm, mobile-first Italian–Greek vocabulary notebook. The application provides a shared-password gate and a real PostgreSQL-backed, paginated library with mobile forms for adding and editing vocabulary meanings. Flashcard practice, import/export, and progress are delivered by the later GitHub tickets.

## Start locally with Docker

Requires Docker Desktop (or Docker Engine with Compose).

1. Copy `.env.example` to `.env`.
2. Fill `POSTGRES_PASSWORD` with a URL-safe password, `SHARED_PASSWORD` with a password of 12–256 characters, and `SESSION_SECRET` with a random secret of 32–256 characters. Generate a secret with `python3 -c "import secrets; print(secrets.token_urlsafe(48))"`.
3. Run `docker compose up --build -d`.
4. Seed once: `docker compose exec backend python -m app.seed`.
5. Open [Italian Notebook](http://localhost:5173) and enter your shared password.

Compose exposes the UI and API only on localhost. PostgreSQL has a persistent named volume and **no published port**. Startup runs Alembic migrations before serving requests. Seeding is explicit; rerunning it is idempotent for the original seed identities and does not overwrite existing data. Do not use it to reset a modified library.

The initial library has ten entries in Unit 00, Benvenuti. Unit 01, Un nuovo inizio, is initially empty. Foteini and Spyros are seeded learner profiles; choose or create a learner from Learners & settings. Names are trimmed and must contain 1–80 characters. Learning direction defaults to Greek to Italian and session size to 25 (choices: 10, 25, 50, or All; the API represents All as `null`). These preferences are stored in PostgreSQL and follow the profile across devices. The last selected profile is remembered only on this device; a missing profile prompts a fresh selection. Interface language defaults to Greek and can be changed to English or Italian from the header.

## Run without application containers

Use Python 3.14, Node 24, and a PostgreSQL 17 database. Keep PostgreSQL private or bound to localhost.

```sh
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
```

Supply `DATABASE_URL`, `SHARED_PASSWORD`, `SESSION_SECRET`, `PUBLIC_ORIGIN=http://localhost:5173`, and `COOKIE_SECURE=false` in the backend environment (or its untracked `.env`). Then run:

```sh
.venv/bin/alembic upgrade head
.venv/bin/python -m app.seed
.venv/bin/uvicorn app.main:create_app --factory --host 127.0.0.1 --port 8000
```

In a second terminal:

```sh
cd frontend
npm ci
npm run dev
```

Vite proxies `/api` to the backend, keeping browser requests on one origin. Override `API_PROXY_TARGET` only when the backend is at another internal address. Build the frontend with `npm run build`; FastAPI can serve that build directly at port 8000 when `PUBLIC_ORIGIN` matches that address.

## Tests and checks

API tests use a **disposable real PostgreSQL database**, not SQLite. The configured test database name must end in `_test`; fixtures migrate and seed it and clear gate-session/throttle tables between tests. Never point tests at a live database.

```sh
docker run -d --name notebook-test-postgres \
  -e POSTGRES_PASSWORD=lexi-test-only -e POSTGRES_DB=lexi_test \
  -p 127.0.0.1:55432:5432 postgres:17-alpine
```

Wait until `docker exec notebook-test-postgres pg_isready -U postgres -d lexi_test` succeeds, then:

```sh
cd backend
.venv/bin/pytest
.venv/bin/ruff check app tests alembic
.venv/bin/python -m compileall -q app
```

Override `TEST_DATABASE_URL` for another disposable PostgreSQL database. For container-based testing, create `notebook_test` inside the Compose PostgreSQL service and run pytest in the backend service with that database URL. Tests create their own static-shell fixture and do not require a prior frontend build.

```sh
cd frontend
npm test
npm run lint
npm run build
```

Tests observe public HTTP behavior and rendered user interactions: gate authentication, CSRF, throttling across restarts, logout revocation, secret rotation, production-cookie flags, pagination, seeded metadata, connection retries, language selection, and returning to the gate after session revocation. There is no TypeScript typecheck; JavaScript lint/build and Python validation run instead.

Against an untouched, seeded running app, supply `SHARED_PASSWORD` and run `python3 scripts/smoke.py` from the repository root. It checks the gate, CSRF, profiles/units, both library pages, and logout through real HTTP. Set `SMOKE_BASE_URL` to the target origin. This smoke check expects the initial ten-entry library.

## Production image and Railway

Build the single application image with `docker build -t italian-notebook .`. It packages the React build and FastAPI together, runs as a non-root user, and listens on Railway's `PORT` (8000 by default). Runtime dependencies are pinned; frontend builds use the lockfile. Development-only frontend/backend Dockerfiles support local Compose.

On Railway, create an application service using the root Dockerfile and a separate PostgreSQL service in the same project environment. Supply:

- `DATABASE_URL`: the **private** PostgreSQL connection URL. The app accepts Railway's `postgresql://` form and selects psycopg automatically.
- `SHARED_PASSWORD` and `SESSION_SECRET`: independently generated secret values.
- `PUBLIC_ORIGIN`: the exact HTTPS origin, such as `https://your-app.up.railway.app`, without a path.
- `COOKIE_SECURE=true`: required for HTTPS production; this is the application default.
- `FORWARDED_ALLOW_IPS`: trusted proxy addresses if relying on forwarded client IPs. Do not trust arbitrary forwarded headers on an exposed server. With no trusted proxy configured, throttling groups requests by the connecting proxy address.

Use `/api/health` as the health-check path. Railway supplies HTTPS; there is no separate production reverse-proxy container. Keep PostgreSQL on the private network. Run `python -m app.seed` once in the deployed application environment using Railway's service shell or an equivalent one-off command on the private network. Starting the image does not seed automatically.

The gate uses expiring opaque sessions stored in PostgreSQL (seven days by default), Secure/HttpOnly/SameSite cookies, signed CSRF tokens, Origin checks, and a database-backed five-attempts-per-minute login limit per connecting client. Repeated restarts do not reset that limit. Lock notebook revokes the server session and removes cached library data from the current UI. Rotate `SESSION_SECRET` to invalidate all sessions. When changing the shared password, rotate the session secret as well. There is no individual authentication: everyone admitted may use every learner profile and the shared library.

Private responses use `Cache-Control: no-store`. Only the generic frontend shell and its compiled assets are available without authentication; vocabulary, profiles, units, and the generated OpenAPI document require the gate. Access `/api/openapi.json` in a logged-in browser for FastAPI's API schema.

## Database maintenance

Enable Railway's opt-in daily PostgreSQL volume backups. For local Compose backups:

```sh
docker compose exec -T postgres pg_dump -U notebook -d notebook -Fc > notebook.dump
```

Restore into a **new disposable database** first:

```sh
docker compose exec postgres createdb -U notebook notebook_restore
docker compose exec -T postgres pg_restore -U notebook -d notebook_restore < notebook.dump
```

Verify the restored library before planning a live database replacement. Do not publish the database port to perform backups. `docker compose down` retains the named volume; removing that volume discards local data.

## Add and edit vocabulary meanings

Choose **Add entry** in Vocabulary, or **Edit entry** on a library card. Each entry represents one meaning: add a new entry for a different meaning, and edit wording or grammatical information on the existing entry. Italian, Greek and one of the six word types are required. Independent Italian/Greek genders, plurals and examples, notes and pronunciation text are optional. Text retains accents and leading articles; only surrounding whitespace is trimmed. Blank optional text clears the field. Text fields are limited to 500 characters, or 10,000 for examples, notes and pronunciation.

Saving refreshes the library and shows the saved pair. Matching Italian–Greek pairs produce a warning after saving, without blocking a distinct meaning. Matching uses Unicode NFC, case folding and surrounding whitespace trimming; accents and articles remain significant. Edits preserve the entry ID and unit.

The gated API supports `POST /api/vocabulary`, `GET /api/vocabulary/{id}` and partial `PATCH /api/vocabulary/{id}`. Writes require the session's CSRF token. Save responses contain `entry` and `duplicate_ids`; validation errors identify fields in `error.fields`. Optional `unit_id` must reference an existing unit. The form leaves unit assignment unchanged; unit/tag management belongs to the later ticket.

## Current scope

This slice provides a gated vocabulary library with add/edit forms, learner selection/creation/editing and persisted preferences, seeded unit metadata, pagination, language selection, health checks, migrations, container builds, tests, and startup documentation. Flashcard practice, library filtering, CSV tools, progress, and PWA installation remain in the subsequent tickets. Full Railway release verification and a backup/restore rehearsal belong to the final release ticket.
