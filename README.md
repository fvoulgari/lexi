# Lexi

A personal vocabulary app for practising the words you're actually learning.

Lexi started with my Italian lessons. I wanted to practise my own vocabulary without reaching for a notebook and pen, with flashcards and practice sessions I could shape around the way I learn.

I built the first version with AI assistance, using React, FastAPI and PostgreSQL. AI helped me turn the idea into a specification and implement the foundation; I chose the stack, tested and reviewed the work, and refined the experience through everyday use.

The current work supports every ordered pair of 35 curated registry languages — Arabic, Bengali, Bulgarian, Catalan, Chinese, Czech, Danish, Dutch, English, Finnish, French, German, Greek, Hebrew, Hindi, Hungarian, Indonesian, Italian, Japanese, Korean, Norwegian, Persian, Polish, Portuguese, Romanian, Russian, Slovak, Spanish, Swedish, Swahili, Thai, Turkish, Ukrainian, Urdu and Vietnamese — including legacy `it/el` and generic pairs such as `en/da`, `ja/en` and `ar/en`. Base and Learning languages are chosen with searchable pickers; cards, progress and collection pairs stay orientation-independent. The interface keeps its calm sage-green and cream design for phones and desktop browsers. In Vocabulary, select a Collection to create a card for its language pair. You can edit any card you own from Vocabulary. No release was published for this work.

## Features

- **Your own vocabulary.** Add and edit words or phrases, with examples, pronunciation text and grammatical forms relevant to their part of speech.
- **An organised library.** Organise cards into Collections and filter Vocabulary by collection. Reuse a card across collections without copying it.
- **Practice in either direction.** Choose either direction of a Collection's language pair, with random, difficult or mixed sessions and optional collection and card-type filters.
- **Individual learning records.** Each account has its own preferences and review history. Progress follows the same card ID across compatible collections and is tracked per learning direction.
- **CSV import and export.** Choose a destination, detect the format and confirm a shared preview before importing. Download simple, v2 or v3 templates, and export Collections in pair-scoped language-ID-keyed CSV v2 or lossless v3. Version 1 and historical registry-wide v2 files remain importable; format numbers are not release versions.
- **Three interface languages.** Greek, English and Italian.
- **Home-screen installation.** Install on supported browsers. Vocabulary and practice still require an internet connection.

## How practice works

Sign in, choose a direction and session size, and start practising. Reveal each answer before rating how well you remembered it. Reviews feed into your session summary, difficult-card selection and progress page.

Collections and card types narrow a session to the material you want to study. Leaving those filters empty uses the vocabulary you can access. Mixed practice combines difficult cards, recently practised cards and random selections, without repeating a card within the queue.

Session recall counts **Hard + Easy** responses as a proportion of submitted reviews. It describes that session, rather than claiming long-term mastery. Revealing an answer alone does not count as a review.

## Scope and access

Sign in with Google or register with email and password. Email/password accounts verify their email before opening the notebook. Each account has a dedicated learner profile. The legacy claim links and learner recovery-request flows are retired.

Collections start private by default. Owners can publish or unpublish them. Publishing a collection can share the owner's cards with other signed-in learners after explicit confirmation. Cards retain their IDs and personal progress across collections. Unpublishing or deleting a collection removes sharing through that collection. Cards and learning history are preserved, and other valid publications keep their grants.

See the [authentication guide](docs/authentication.md) and [Collections guide](docs/shareable-collections.md).

Interface language is independent of the languages on the cards. Vocabulary supports creation and editing for Collections across all 35 languages in the curated registry. The registry may also contain backend-supported rows that are deliberately not advertised; only rows marked publicly available appear in the searchable pickers and `/api/languages`. Base and Learning are selected from that one registry; their orientation does not change the unordered pair, cards, progress or permissions. Cards store their language IDs explicitly, so a compatible card can join several Collections and reversed pair order keeps the same text mapping. Italian and Greek have their historical grammar definitions, and Danish has structured-only `common`/`neuter`, plural, example and pronunciation; all other curated languages use common fields only. A populated Collection cannot change pair; practice direction can. Pronunciation is entered as text; automatic translation and generated speech are not included. See the [multilingual acceptance matrix](docs/multilingual-acceptance.md), [language-extension runbook](docs/language-extension-runbook.md) and [Collections guide](docs/shareable-collections.md).

## Technology

| Layer | Technology |
| --- | --- |
| Frontend | React, JavaScript/JSX, Vite, React Router, TanStack Query |
| Backend | Python, FastAPI, Pydantic, SQLAlchemy |
| Database | PostgreSQL, Alembic migrations |
| Testing | pytest, Vitest, Testing Library, Playwright |
| Delivery | Docker, GitHub Actions, GHCR, Railway |

In production, Cloudflare Tunnel routes the public origin to one Railway application container serving React and FastAPI. A separate private PostgreSQL 18 service holds application data. SuperTokens Core manages identity and sessions, and Resend delivers verification and reset email.

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
| `SUPERTOKENS_CONNECTION_URI`, `SUPERTOKENS_API_KEY` | Approved development Core connection and backend API key |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google web client with the exact local callback |
| `RESEND_API_KEY`, `EMAIL_FROM` | Protected HTTPS email API credential and verified sender for verification/reset emails |


Use unique protected credentials and follow [provider setup](docs/authentication.md). Missing authentication configuration fails closed; there is no shared-password fallback.

**Local database networking:** Compose publishes PostgreSQL only on `127.0.0.1:5432`, making it available to native development at `localhost:5432`. Application containers connect through the Compose service name, `postgres:5432`.

If upgrading an existing installation, follow [the PostgreSQL 17 migration steps](#existing-postgresql-17-installations) before starting this stack. PostgreSQL 18 uses a separate, initially empty volume.

```sh
docker compose build
docker compose up -d --wait postgres
docker compose run --rm --no-deps --entrypoint alembic backend upgrade head
docker compose up -d --wait
```

Open [localhost:5173](http://localhost:5173) and sign in with Google or email/password. Registration creates your own learner profile; no profile selection is required.

To add the optional sample library, first identify your **local** account ID and
then explicitly select it as owner. This does not target production:

```sh
docker compose exec postgres psql -U notebook -d notebook -c 'SELECT a.id, p.display_name FROM accounts a JOIN profiles p ON p.id = a.profile_id;'
docker compose exec backend python -m app.seed --owner-account-id YOUR_LOCAL_ACCOUNT_ID
```

Run migrations separately with a schema-owner credential before starting a new
release. Application startup checks the schema revision and fails closed when it
does not match; it does not run migrations. The local Compose example uses the
same development credential for both commands. Seeding is an explicit first-time
action, not a reset command. `docker compose down` retains the named database
volume; removing that volume deletes local data.

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

Configure `backend/.env` with `DATABASE_URL`, the provider/email variables above, `PUBLIC_ORIGIN=http://localhost:5173`, and `COOKIE_SECURE=false` for local HTTP. If using the Compose database, configure the root `.env` too and run `make db-up`.

```sh
make migrate-local
make backend
```

In a second terminal:

```sh
make frontend
```

After signing in and identifying your local account ID, optionally run
`make seed-local SEED_OWNER_ACCOUNT_ID=YOUR_LOCAL_ACCOUNT_ID` in another terminal.

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

Tests cover authentication and CSRF, profile handling, vocabulary validation, CSV workflows, review retries, progress calculations and rendered UI interactions. Browser suites exercise installation/cache behavior, mobile navigation, the registry-backed language picker, RTL/non-Latin text and the localized Collections/CSV journeys. The rule-to-test mapping is in the [acceptance matrix](docs/multilingual-acceptance.md); final backend, frontend, browser and migration-rehearsal results are in the [language-architecture verification record](docs/language-architecture-verification.md).

GitHub Actions runs application tests, lint/build checks and image-publication validation. The separate Playwright suites are not included in that workflow yet.

## Deployment

The production image runs as a non-root user. SuperTokens sessions, same-origin write checks, and authentication throttling protect account access. The application uses a restricted PostgreSQL runtime login. Schema changes run separately with an operator-controlled schema-owner connection. The service worker caches only the generic application shell and public static assets, not vocabulary or API responses.

Successful `main` checks publish a SHA-tagged image. Stable version tags trigger release checks and deployment of the verified image digest to Railway. See the [release runbook](docs/railway-release.md) for configuration, migrations and recovery. Keep independent protected backups and verify restores on an isolated database before relying on them. Follow the [staging restart procedure](docs/staging-restart.md) to resume the retained staging deployments. Use a separate disposable instance if offering a public demo.

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
- [Architecture decisions](docs/adr/0001-railway-application-and-private-postgresql.md) ([ADR 0005: card text and grammar](docs/adr/0005-language-agnostic-card-text-and-grammar.md))
- [Multilingual acceptance matrix](docs/multilingual-acceptance.md)
- [Language-extension runbook](docs/language-extension-runbook.md)
- [Final language-architecture verification](docs/language-architecture-verification.md)
- [v1.4.0 work: readiness and local rehearsal](docs/v140-release-readiness.md)
- [CSV format](docs/csv-format.md)
- [Shareable Collections](docs/shareable-collections.md)
- [Mixed-practice selection](docs/mixed-practice.md)
- [Design notes](docs/design.md)
- [Image publication](docs/image-publication.md)
- [Railway deployment and recovery](docs/railway-release.md)
- [Release verification](docs/release-verification.md)

## License

[GPL-3.0](LICENSE).
