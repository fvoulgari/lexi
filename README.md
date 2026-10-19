# Lexi

A personal vocabulary app for practising the words you're actually learning.

Lexi started with my Italian lessons. I wanted to practise my own vocabulary without reaching for a notebook and pen, with flashcards and practice sessions I could shape around the way I learn.

I built the first version with AI assistance, using React, FastAPI and PostgreSQL. AI helped me turn the idea into a specification and implement the foundation; I chose the stack, tested and reviewed the work, and refined the experience through everyday use.

The current version focuses on **Italian ↔ Greek**, with a calm sage-green and cream interface designed for phones as well as desktop browsers.

## Features

- **Your own vocabulary.** Add and edit words or phrases, with examples, pronunciation text and grammatical forms relevant to their part of speech.
- **An organised library.** Every card belongs to a unit. Search, filter, or move selected cards between units.
- **Practice in either direction.** Choose Italian → Greek or Greek → Italian, with random, difficult or mixed sessions and optional unit and card-type filters.
- **Individual learning records.** Learner profiles keep separate preferences and review histories, tracked independently for each learning direction.
- **CSV import and export.** Preview imports before confirming them, download an example, and export the full vocabulary library.
- **Three interface languages.** Greek, English and Italian.
- **Home-screen installation.** Install on supported browsers. Vocabulary and practice still require an internet connection.

## How practice works

Select a learner profile, choose a direction and session size, and start practising. Reveal each answer before rating how well you remembered it. Reviews feed into your session summary, difficult-card selection and progress page.

Units and card types narrow a session to the material you want to study. Leaving those filters empty uses the shared library. Mixed practice combines difficult cards, recently practised cards and random selections, without repeating a card within the queue.

Session recall counts **Hard + Easy** responses as a proportion of submitted reviews. It describes that session, rather than claiming long-term mastery. Revealing an answer alone does not count as a review.

## Scope and access

Lexi is built for a **small, trusted learning group**. A shared password controls access. Everyone admitted can edit the shared vocabulary library and select any learner profile. Profiles separate learning records; they are not private user accounts.

Interface language is independent of the languages on the cards. The current vocabulary model supports Italian and Greek, not arbitrary language pairs. Pronunciation is entered as text; automatic translation and generated speech are not included.

## Technology

| Layer | Technology |
| --- | --- |
| Frontend | React, JavaScript/JSX, Vite, React Router, TanStack Query |
| Backend | Python, FastAPI, Pydantic, SQLAlchemy |
| Database | PostgreSQL, Alembic migrations |
| Testing | pytest, Vitest, Testing Library, Playwright |
| Delivery | Docker, GitHub Actions, GHCR, Railway |

In production, one application container serves the built frontend and API from the same origin. A separate, privately connected PostgreSQL service holds the durable data.

## Run locally

### Docker Compose

Requires Git and Docker with Compose. Host Python and Node installations are not needed for this route.

```sh
git clone https://github.com/fvoulgari/lexi.git
cd lexi
cp .env.example .env
```

Set these values in the untracked `.env` file:

| Variable | Value |
| --- | --- |
| `POSTGRES_PASSWORD` | A unique, URL-safe database password |
| `SHARED_PASSWORD` | Your application password, 12–256 characters |
| `SESSION_SECRET` | An independently generated random secret, 32–256 characters |

Use a password manager or a cryptographically secure generator. If Python is installed, generate a session secret with:

```sh
python3 -c "import secrets; print(secrets.token_urlsafe(48))"
```

**Local database networking:** Compose publishes PostgreSQL only on `127.0.0.1:5432`, making it available to native development at `localhost:5432`. Application containers connect through the Compose service name, `postgres:5432`.

If upgrading an existing installation, follow [the PostgreSQL 17 migration steps](#existing-postgresql-17-installations) before starting this stack. PostgreSQL 18 uses a separate, initially empty volume.

```sh
docker compose up --build -d --wait
docker compose exec backend python -m app.seed
```

Open [localhost:5173](http://localhost:5173), enter your shared password, and choose or create a learner profile.

Startup applies database migrations. Seeding is an explicit first-time action, not a reset command. `docker compose down` retains the named database volume; removing that volume deletes local data.

### Existing PostgreSQL 17 installations

Compose now uses PostgreSQL 18 with a separate `postgres18_data` volume mounted
at `/var/lib/postgresql`, following the [official image storage layout](https://hub.docker.com/_/postgres).
The previous `postgres_data` volume is retained and is never mounted in PostgreSQL
18. A new volume starts empty; existing records are not migrated automatically.
If you have an existing PostgreSQL 17 database, back it up **before** starting the
updated stack. Do not change the old volume's image major version or remove it.

With the old PostgreSQL 17 service still running, stop application writes and
export a logical backup outside the repository. Keep it private: it contains
application data and session records.

```sh
docker compose stop backend
(umask 077; docker compose exec -T postgres pg_dump -U notebook -d notebook -Fc > ../lexi-pg17.dump)
```

Check the backup command succeeded before proceeding. Then stop the old database,
start the new database, and restore before starting the application:

```sh
docker compose stop postgres
docker compose up -d --wait postgres
docker compose exec -T postgres pg_restore -U notebook -d notebook --exit-on-error < ../lexi-pg17.dump
docker compose up --build -d --wait
```

Verify restored records in the application and retain the old volume and backup until satisfied. Do not run
`down -v`. The commands above are an explicit operator migration, not a setup step
for fresh installations.

### Native development

Use Python **3.14**, Node **24**, and PostgreSQL **18**, matching Compose, the test database helper, CI and production. Native frontend development and preview bind to `127.0.0.1` by default; the frontend container explicitly listens on its container interfaces, with Compose publishing it only on host loopback.

```sh
make setup PYTHON=python3.14
```

Configure `backend/.env` with `DATABASE_URL`, `SHARED_PASSWORD`, `SESSION_SECRET`, `PUBLIC_ORIGIN=http://localhost:5173`, and `COOKIE_SECURE=false` for local HTTP. If using the Compose database, configure the root `.env` too and run `make db-up`.

```sh
make migrate-local
make seed-local
make backend
```

In a second terminal:

```sh
make frontend
```

The root `.env` configures Compose; `backend/.env` configures native commands. Both, along with local `.env.*` variants, are excluded from Git and Docker build contexts. `.env.example` templates remain included. `make env` creates templates without overwriting existing files. Run `make help` for available commands.

## Tests and checks

After installing native development dependencies:

```sh
make test-db-up
make check
make test-db-down
```

The helper creates PostgreSQL 18 at `127.0.0.1:55432` and validates an existing
container's image, credentials and localhost-only binding before starting it.
Incompatible containers are left unchanged. For an older disposable test database,
first confirm its contents can be retired, then stop and rename it (for example,
`notebook-test-postgres-pg17`) before rerunning `make test-db-up`. This preserves
the old container and its data; it does not upgrade them. The helper also checks
an authenticated connection to `lexi_test` and the running server's major version.

`make check` runs backend and frontend tests, lint, Python compilation and the frontend production build. Backend tests use a separate real PostgreSQL database whose name must end in `_test`. **Never point `TEST_DATABASE_URL` at a database containing data you want to keep.**

Run frontend browser checks separately:

```sh
cd frontend
npx playwright install chromium
npm run test:pwa
npm run test:mobile
```

Tests cover authentication and CSRF, profile handling, vocabulary validation, CSV workflows, review retries, progress calculations and rendered UI interactions. Browser suites exercise installation/cache behavior and mobile navigation.

GitHub Actions runs application tests, lint/build checks and image-publication validation. The separate Playwright suites are not included in that workflow yet.

## Deployment

The production image runs as a non-root user. Expiring server-side sessions, CSRF validation and login throttling protect the shared gate. The service worker caches only the generic application shell and public static assets, not vocabulary or API responses.

Successful `main` checks publish a SHA-tagged image. Stable version tags trigger release checks and deployment of the verified image digest to Railway. See the [release runbook](docs/railway-release.md) for configuration, migrations, backups and recovery. Use a separate disposable instance if offering a public demo.

## Project layout

| Path | Contents |
| --- | --- |
| `frontend/` | React application, styles, component tests and browser checks |
| `backend/app/` | API, authentication, vocabulary, imports, practice and progress |
| `backend/alembic/` | Database migrations |
| `backend/tests/` | Backend tests |
| `data/` | Initial seed data |
| `scripts/` | Development, verification and release tooling |
| `.github/workflows/` | CI, image publication and deployment |
| `docs/` | Design, formats, architecture and operational guides |

## Documentation

- [Domain glossary](GLOSSARY.md)
- [Architecture decision](docs/adr/0001-railway-application-and-private-postgresql.md)
- [CSV format](docs/csv-format.md)
- [Mixed-practice selection](docs/mixed-practice.md)
- [Design notes](docs/design.md)
- [Image publication](docs/image-publication.md)
- [Railway deployment and recovery](docs/railway-release.md)
- [Release verification](docs/release-verification.md)

## License

[GPL-3.0](LICENSE).
