# Italian Notebook

A calm, mobile-first Italian–Greek vocabulary notebook. The application provides a shared-password gate and a real PostgreSQL-backed, paginated library with mobile forms for adding and editing vocabulary meanings. Random flashcard practice saves reviews and independent learner records. Home and Progress show independent learner review histories. CSV import supports preview and confirmation, and the full library can be exported safely as CSV.

## Development shortcuts

Run `make` or `make help` from the repository root to see the available commands. Use Python 3.14, Node 24, and Docker for the PostgreSQL services.

For the Docker application stack:

```sh
make env
# Configure the root .env as described below.
make up
make seed  # Explicit first-time seeding.
make logs
# Stop services while keeping database volumes:
make down
```

For native development with hot reload:

```sh
make setup PYTHON=python3.14
# Configure backend/.env with your local database URL and application settings.
# If using Compose PostgreSQL, configure the root .env too.
make db-up
make migrate-local
make seed-local
make backend
# In a second terminal:
make frontend
```

`make env` preserves existing environment files. Root `.env` configures Compose; `backend/.env` configures native backend commands. Both are untracked. Seeding remains explicit. If PostgreSQL is already running elsewhere, skip `make db-up` and set the native database URL accordingly.

For checks after installing local dependencies:

```sh
make test-db-up
make check                  # Python/JavaScript lint, tests, and frontend build.
make test-backend PYTEST_ARGS="-q tests/test_imports.py"
make test-db-down
```

The test database is separate from development data and uses the existing default test URL on localhost:55432. `make test-db-up` creates or restarts it and waits for readiness. Test commands do not start Docker automatically, so an exported `TEST_DATABASE_URL` can point to another disposable database ending in `_test`. `make test-pwa` runs the browser checks when Playwright Chromium is installed. `make smoke` checks a running application using an exported `SHARED_PASSWORD` and optional `SMOKE_BASE_URL`.

## Start locally with Docker

Requires Docker Desktop (or Docker Engine with Compose).

1. Copy `.env.example` to `.env`.
2. Fill `POSTGRES_PASSWORD` with a URL-safe password, `SHARED_PASSWORD` with a password of 12–256 characters, and `SESSION_SECRET` with a random secret of 32–256 characters. Generate a secret with `python3 -c "import secrets; print(secrets.token_urlsafe(48))"`.
3. Run `docker compose up --build -d`.
4. Seed once: `docker compose exec backend python -m app.seed`.
5. Open [Italian Notebook](http://localhost:5173) and enter your shared password.

Compose exposes the UI and API only on localhost. PostgreSQL has a persistent named volume and **no published port**. Startup runs Alembic migrations before serving requests. Seeding is explicit; rerunning it is idempotent for the original seed identities and does not overwrite existing data. Do not use it to reset a modified library.

The initial library has ten entries in Unit 00, Benvenuti. Unit 01, Un nuovo inizio, is initially empty. Foteini and Spyros are seeded learner profiles; choose or create a learner from Learners & settings. Names are trimmed and must contain 1–80 characters. Learning direction defaults to Greek to Italian and session size to 25 (choices: 10, 25, 50, or All; the API represents All as `null`). These preferences are stored in PostgreSQL and follow the profile across devices. The last selected profile is remembered only on this device; a missing profile prompts a fresh selection. Interface language defaults to Greek and can be changed to English or Italian from the header or Learners & settings. Interface language and motion preferences are saved automatically on this device, independently of learner preferences. Motion can follow the device setting, reduce motion, or allow full motion; operating-system reduced motion always overrides full motion, including changes made while the app is open. If browser storage is unavailable, settings still work until reload.

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

GitHub Actions runs the backend and frontend checks below on pull requests targeting
`main` and every push to `main`. The **Application checks passed** job succeeds only
when both **Backend checks** and **Frontend checks** succeed; failed, skipped, or
cancelled checks fail the gate. CI uses Python 3.14, Node 24, and disposable
PostgreSQL 17. PR checks have read-only repository access. Successful main checks publish the
production image to GHCR. Published releases and prereleases run the same checks
on their tagged commit and publish exact release/SHA tags without changing latest;
see [image publication](docs/image-publication.md) for
tags, ordering, public-package setup, and verification.


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

Against a running app, supply `SHARED_PASSWORD` and run `python3 scripts/smoke.py` from the repository root. It checks health, the frontend shell, gate, CSRF, profiles/units, pagination, private cache policy and logout through real HTTP. Set `SMOKE_BASE_URL` to the target origin. The [release runbook](docs/railway-release.md) documents opt-in disposable import/practice/progress checks and restart/restore verification.

## Production image and Railway

Follow the [Railway release runbook](docs/railway-release.md) for deployment, proxy trust, migrations, backups and recovery. See the [verification record](docs/release-verification.md) for release evidence. Production deployment requires separate authorization.

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

Choose **Add entry** in Vocabulary, or **Edit entry** on a library card. Each entry represents one meaning: add a new entry for a different meaning, and edit wording or grammatical information on the existing entry. Italian, Greek and one of the six word types are required. Nouns and adjectives also require explicit Italian and Greek genders beside their main entries. Plurals, additional adjective forms, examples and pronunciation remain optional. Notes are no longer shown or edited; existing stored notes remain preserved for API/CSV compatibility. Text retains accents and leading articles; only surrounding whitespace is trimmed. Blank optional text clears the field. Text fields are limited to 500 characters, or 10,000 for examples, notes and pronunciation.

Saving refreshes the library and shows the saved pair. Matching Italian–Greek pairs produce a warning after saving, without blocking a distinct meaning. Matching uses Unicode NFC, case folding and surrounding whitespace trimming; accents and articles remain significant. Edits preserve the entry ID.

The gated API supports `POST /api/vocabulary`, `GET /api/vocabulary/{id}` and partial `PATCH /api/vocabulary/{id}`. Writes require the session's CSRF token. Save responses contain `entry` and `duplicate_ids`; validation errors identify fields in `error.fields`. Optional `unit_id` must reference an existing unit. The form supports one unit and any number of tags independently of word type. Clearing the unit chooses No unit; clearing all tag checkboxes removes those assignments. Omitting either assignment field in a partial API edit preserves it.

## Organize and find vocabulary

Use **Create unit** or **Create tag** in Vocabulary to extend the library without redeployment. Unit codes are text (for example, `007`), unique, and stable; titles and explicit integer ordering determine their display. Tags have unique names. Add/edit forms assign units and tags, and cards show both.

Search matches Italian or Greek text, case-insensitively, retaining accents. `%` and `_` are literal text. Expand **Filters** to select units (including No unit), word types and tags. Values within a group are ORed; selected groups and search are ANDed. Changing criteria returns to page 1; Clear filters restores the whole library. Results and counts are computed in PostgreSQL, with bounded pages and deterministic Italian/ID ordering.

The gated API adds `GET/POST /api/tags` and `POST /api/units`; creation requires CSRF. Units accept `code`, `title`, `sort_order`; tags accept `name`. Duplicate codes/names return 409. Vocabulary writes accept `tag_ids` and `unit_id`; unknown IDs return 422 without saving partial changes. Vocabulary outputs include `tags`. List requests support `q`, repeated `unit_ids`, `no_unit=true`, repeated `word_types`, and repeated `tag_ids`, alongside `page` and `page_size` (maximum 100). For example, `?word_types=noun&word_types=verb&no_unit=true` finds nouns or verbs without a unit.

## Current scope

This slice provides a gated vocabulary library with add/edit forms, learner selection/creation/editing and persisted preferences, seeded unit metadata, pagination, language selection, health checks, migrations, container builds, tests, and startup documentation. Release verification and the disposable backup/restore rehearsal are recorded in [the release verification record](docs/release-verification.md).


## Random practice

Open **Practice** or **Start practice** on Home. Choose a learner, learning direction and 10/25/50/All cards; learner preferences supply the initial choices. The queue is shuffled in PostgreSQL and never repeats an entry. A smaller library produces an explained shorter session; an empty library keeps setup open.

Use **Reveal answer** by tap, Enter or Space, then choose Again, Hard or Easy. Grammar, plurals, examples, notes and pronunciation text appear only on the answer side. Switching direction retains the queue and hides the answer until it is revealed again. While saving, ratings and direction are disabled. A failed review keeps the answer and chosen rating; **Retry** submits that same review. Accepted retries return the original event, and conflicting ratings return 409.

After a failed save, finishing stays disabled until Retry confirms acceptance. This keeps a review whose response was lost available for recovery. Once confirmed, the next card allows direction changes and finishing again.

**Finish and see summary** allows a partial or zero-review summary. Remembered this session is `(Hard + Easy) / submitted reviews`, shown as 0% with an explanation when there are no reviews. Practice Again returns to setup; Return Home exits. Leaving or reloading opens fresh setup. Accepted reviews remain stored; no session ID or unfinished queue is saved on the device.

The gated API provides `POST /api/sessions` with `profile_id`, `direction` and `size` (10/25/50 or null for All), `GET /api/sessions/{id}`, `POST /api/sessions/{id}/cards/{position}/reveal` with `direction`, `POST /api/sessions/{id}/cards/{position}/reviews` with `direction` and `rating` (`again`, `hard`, `easy`), and `GET /api/sessions/{id}/summary`. Positions are zero-based. Writes require CSRF. Session cards and review events preserve the selected vocabulary wording even after library edits. Review events have no update/delete API.

`GET /api/profiles/{id}/learning-records` returns independent counts and difficulty for each entry and direction. Review and aggregate changes commit together. Writes lock the practice session and then the learner so concurrent retries create one event per card and parallel sessions cannot lose aggregate updates. Difficulty maintains weighted sum and weight: on an accepted review multiply each previous value by 0.8, add the rating value (Again 1, Hard 0.5, Easy 0) to the sum, and add 1 to the weight; difficulty is sum / weight. Concurrent submissions follow serialized acceptance order, including when timestamps tie. Reading does not decay the score.

The practice migration adds four tables without changing existing vocabulary. Application rollback can leave these tables in place; downgrading the migration deletes practice history. The API tests cover snapshots, retries, concurrent submissions, rollback on database failure, application restart, isolation and shortages; rendered tests cover reveal, retry, direction switches, summaries and fresh setup.

## Grammar fields by part of speech

The add/edit form places part of speech and Unit (including creating a unit) in the first row, then Italian/Greek entries with their corresponding genders. Optional details include both examples and pronunciation. Required noun/adjective gender selectors sit beside the corresponding main fields, outside optional details. The six existing categories are unchanged.

- **Nouns:** independent Italian and Greek genders and plurals. Italian offers masculine and feminine; Greek also offers neuter. Both genders require explicit selection on create or edit. Each card represents the form entered with its article (`il barista` is masculine, `la barista` feminine). Legacy `common` values open unset for manual correction without inferring gender from articles. Articles and invariable plurals are entered manually and preserved.
- **Adjectives:** Italian and Greek each have their own main-form gender, separate from noun gender. Neither language defaults or infers gender; Italian supports masculine/feminine and Greek also neuter. The main text is the singular form of that selected gender. Optional fields start with its plural, then show each remaining gender under a short heading with paired Singular/Plural inputs. Greek forms are nominative. All forms are manually entered (up to 500 characters), including identical, irregular or invariable forms. Changing a selector reorders the fields without moving values between labels or overwriting the main text. Existing combined translations such as `ψηλός, -ή, -ό` are not split. Old cards with missing gender stay readable and reviewable, but must be corrected when next saved.
- **Verbs, adverbs, expressions and other:** examples and pronunciation only. No conjugation tables or new categories are added.

Switching categories preserves unsaved grammar in the form; saving clears incompatible grammar in that card through both API and CSV writes. Partial API edits preserve compatible omitted fields. Cards, practice snapshots and previews display only grammar relevant to their part of speech and the answer language. Empty details are omitted. Existing legacy metadata is hidden where irrelevant and is only cleaned when a card is saved; generic plurals are never inferred to be adjective forms.

Migration `a35b66f8c007` added three nullable Italian adjective-form columns. Migration `b46c77a9d008` adds seven missing form columns (Italian masculine singular and all six Greek forms), two independent nullable main-form gender columns, and nullable `greek_pronunciation`. Existing `pronunciation` remains Italian pronunciation. Neither migration rewrites existing vocabulary or learning history. Run the existing migrations before starting the updated backend (`make migrate-local`, or automatic startup migrations in Docker).

Pronunciation has independent Italian and Greek text fields for every category. The labels name the language being pronounced, not the writing system; either field accepts Greek characters, Latin notation or other free text. Revealed cards and previews show only the destination language's pronunciation. Grammar pairs, examples and pronunciation have separate spacing. Adjective cards show a compact gender/plural line followed by one singular/plural line per remaining gender; incomplete pairs explicitly identify the populated form. Desktop example fields share one row and pronunciation fields share the next, after both grammar groups. Examples use compact textareas and pronunciation uses single-line free-text inputs. Revealed cards label the destination language’s pronunciation simply “Προφορά” (or the selected interface language’s equivalent).

## Preview and confirm CSV imports

In Vocabulary, choose or create a required destination unit, choose a **CSV file**, then **Preview import**. Inspect the destination, new, updated, duplicate and invalid rows, expandable entry details, and proposed tags. All imported cards use that destination. **Confirm import** explicitly imports new cards and updates changed fields on matching cards, rechecking current library data in one transaction. Failed confirmations retain the file and preview for retry. Changing the file clears its preview. No vocabulary, units or tags are written during preview.

Download the gated example from the import panel or `GET /api/imports/example`. Use UTF-8 CSV (an optional UTF-8 BOM is accepted), at most **1 MiB and 2000 data rows**. Standard CSV quoting allows commas/newlines inside quoted text. Column headers are case-sensitive and unique; unsupported headers and malformed CSV are file errors. Missing/extra row cells are row errors. Row numbers count logical CSV records (header is row 1), including multiline records.

Required columns: `italian`, `greek`, `word_type` (`noun`, `verb`, `adjective`, `adverb`, `expression`, `other`). Optional columns: `italian_adjective_gender`, `greek_adjective_gender`, `italian_masculine_singular`, `greek_masculine_singular`, `greek_masculine_plural`, `greek_feminine_singular`, `greek_feminine_plural`, `greek_neuter_singular`, `greek_neuter_plural`, `greek_pronunciation`, `italian_feminine_singular`, `italian_masculine_plural`, `italian_feminine_plural`, `italian_gender`, `greek_gender`, legacy `gender`, `italian_plural`, `greek_plural`, `italian_example`, `greek_example`, `notes`, `pronunciation`, `unit_code`, `unit_title`, `unit_sort_order`, `tags`, `csv_format`. Existing vocabulary field lengths and gender values apply: Italian nouns accept `masculine`, `feminine`; Greek nouns also accept `neuter`. Gender must be selected independently in both languages when saving a noun or adjective. New API/CSV writes reject `common`; existing stored values are read/exported as unset and are not bulk rewritten. Blank optional text becomes null. `gender` is an Italian-gender alias; disagreeing nonblank alias/explicit values invalidate that row. Greek gender remains independent. Legacy `type`, `unit`, `plural`, and `example` alias `word_type`, `unit_code`, `italian_plural`, and `italian_example`; disagreeing nonblank alias/explicit values are row errors. Pronunciation is plain text: legacy `pronunciation` is Italian, and optional `greek_pronunciation` is Greek. Main adjective genders are independently optional: `italian_adjective_gender` accepts `masculine`/`feminine`; `greek_adjective_gender` also accepts `neuter`. Noun rows require both noun genders, and adjective rows require both main-form genders. CSV updates may omit gender columns only when the existing card already supplies valid genders. Blank cells do not default or infer gender and produce row errors for nouns/adjectives.

`tags` uses pipe-separated names, for example `daily|questions`; names are trimmed, empty names ignored, and repeated names collapsed. A literal pipe cannot be part of a tag name in this legacy encoding. Exported rows carry `csv_format=italian-notebook-v1`, use JSON arrays for tags (including literal pipes), and reversibly decode spreadsheet safety prefixes before validation. See [the CSV format](docs/csv-format.md). Names match existing tags exactly, preserving case and accents. New names are created only for imported or updated rows.

`unit_code` remains text, preserving leading zeros. Optional CSV unit metadata is compared with the explicitly selected destination. Preview flags conflicting metadata and explains that the selected destination takes precedence. Imports do not create units from CSV metadata. Updates also use the chosen destination. Create a unit through the unit form first. Title/order without a code remain row errors.

Matching and update policy: Italian–Greek pairs use Unicode NFC, case folding and surrounding whitespace trimming to identify existing cards. Accents and articles remain significant. For a unique match, supplied fields are compared individually: differences update only those fields while preserving the card ID, practice history and statistics. Missing optional columns preserve stored values; explicitly blank cells clear optional fields. Tags compare as sets; a supplied tags column replaces assignments. The chosen destination unit applies to both new and updated cards. Rows with no differences are duplicates and skipped. Ambiguous pairs matching multiple existing cards are reported as row errors for individual editing. Preview simulates earlier rows in the same file; confirmation checks current library data again.

`POST /api/imports/preview` and `POST /api/imports/confirm` accept the raw CSV body (`Content-Type: text/csv`), require a valid `unit_id` query parameter, and require the gate and CSRF header. Both return `counts` (`imported`, `updated`, `valid`, `skipped`, `duplicate`, `error`), `rows` with logical row number/status/errors/entry details, and `proposed_tags`, plus `destination_unit`, per-row `changed_fields` and `unit_conflict`, and a `unit_conflicts` count. `proposed_units` remains an empty list for compatibility. `valid` counts eligible rows, including new and updated rows; `skipped` is duplicate + error. Confirmation serializes against vocabulary/unit/tag writes while checking, inserting and updating. Import diagnostics preserve detailed backend validation messages; navigation and workflow labels support all three interface languages.


## Delete accidental vocabulary

Choose **Delete entry** on a vocabulary card, check the Italian–Greek meaning, then choose **Permanently delete**. Only entries without any reviews can be deleted. Revealing an answer alone does not prevent deletion. Reviewed entries return an explained conflict and keep their complete history.

The gated `DELETE /api/vocabulary/{id}` endpoint requires CSRF and returns `{"deleted": "<id>"}`. Missing entries return 404; entries with reviews return 409 with `error.code=entry_reviewed`. Deletion and review acceptance lock the same vocabulary entry inside their transactions: if the review commits first, deletion is refused; if deletion commits first, the review returns `entry_deleted` without storing history or progress.

Deleted entries disappear from library search and future practice selections. Existing session snapshots and card positions stay intact. Session reads include `skipped` on each card and `active_count` for the remaining undeleted queue. Reveal/review attempts on a deleted card return 409 with `entry_deleted`; the practice page skips it with a translated explanation and adjusts its count, preserving other cards and accepted reviews. Skipping the last card reaches the summary, including a defined zero-review summary. There is no database migration or change to review foreign keys.
## Category practice

Choose **Category practice** in Practice setup to combine units, word types, and tags. The filter semantics match Vocabulary: values within each group are ORed and selected groups are ANDed. No unit includes unassigned entries alongside any selected units. Leaving all filters clear selects the whole library.

The selected queue is shuffled, contains each matching entry at most once, and respects 10/25/50/All. Shortages show the actual count; zero matches keep setup open with Clear filters and a Vocabulary link. Category practice uses the existing reveal, direction-switch, review, and summary flow with independent learner and direction records.

`POST /api/sessions` also accepts `unit_ids`, `no_unit`, `word_types`, and `tag_ids`. Omitted filters select the whole library. Matching counts and queues are computed in PostgreSQL and selected cards retain their persisted wording snapshots.

## Difficult entries

In Practice, choose a learner and direction, then select **Difficult practice** to see the eligible vocabulary entries and start a shuffled queue using the usual reveal/rating flow. Entries qualify only after at least one accepted review in that learner and direction, with normalized weighted difficulty >= 0.5. Again contributes 1, Hard 0.5, and Easy 0; each successively older review has 0.8 times the weight of the newer one. Inactivity never changes eligibility. Empty sets explain how to proceed, and smaller sets use the existing shortage message. Session summaries continue to show submitted Again/Hard entries needing practice.

`GET /api/profiles/{id}/difficult-entries?direction=greek_to_italian` (or `italian_to_greek`) returns the current entries, score and review count. `POST /api/sessions` accepts optional `mode: "difficult"`; the default remains `"random"`. Difficult selection is performed on the server using the selected learner and direction. No database migration is needed.


## Export vocabulary as CSV

In Vocabulary, choose **Export full library (CSV)**. The action downloads `italian-notebook.csv` with every shared vocabulary entry, regardless of search, filters or pagination. While preparing, the button is disabled. A status announces that the browser download started; it does not claim the file was saved. Errors are displayed and the button allows retry. Expired admission returns to the gate. The protected read-only `GET /api/vocabulary/export.csv` API returns an attachment with `text/csv; charset=utf-8` and `Cache-Control: no-store`. No learner preferences or practice records are exported.

See [the CSV format](docs/csv-format.md) for columns, spreadsheet safety and import compatibility.

## Install and use offline

On an HTTPS deployment, use the browser’s Install/Add to Home Screen menu. On iPhone/iPad, use Share → Add to Home Screen. Development mode does not register a worker; use a production build to verify installation.

The installed notebook caches only the generic HTML shell, compiled JS/CSS, manifest and public icons. Vocabulary and all API responses remain online-only. An offline launch shows a translated connection gate; a connection loss while practising leaves the current card in memory for Retry. Keep the page open to retry; reloading does not restore a private queue. Lock notebook clears the current private UI after the server confirms logout; a failed logout reports an error and does not claim to have revoked the session.

Each build generates a content-versioned worker and an explicit static-file allowlist. A new worker waits until existing notebook tabs close, preserving an open practice card; activation deletes older notebook static caches. No runtime responses are written to Cache Storage. No immediate reload is forced.

Run `cd frontend && npx playwright install chromium && npm run test:pwa` for Chromium checks against the production build (manifest, static cache contents, logout/offline launch, current-card retry, keyboard/touch interaction, 320px overflow and cache replacement). Browser API fixtures deliberately contain a private vocabulary marker to verify it never enters the cache. API tests separately verify the production static routes and private cache headers. Physical iOS/Android installation still needs a device check against HTTPS.

## Home and Progress

Home greets the selected learner and shows the shared vocabulary count, total reviews,
entries practised, difficult entries, and the most recently reviewed session's recall.
Choose a learner on either Home or Progress; the choice follows links into Practice.
Start practice opens setup with that learner's preferences. Practise difficult entries
opens difficult setup in a direction that has eligible entries.

Progress adds Again/Hard/Easy distributions and unit, word type and learning direction
breakdowns, plus difficult-entry lists and practice links for each direction. Overall
entries practised and difficult entries deduplicate vocabulary IDs across directions;
direction views count independently. Unit and word type use saved review-time metadata,
so later library edits do not rewrite history. Empty profiles have zero counts and an
explicit invitation to begin practice. Remembered this session describes session recall,
not mastery or completion.

`GET /api/profiles/{id}/progress` requires the shared gate and returns vocabulary count,
review counts/distributions, distinct entries practised, distinct difficult entries,
unit/type/direction breakdowns and a nullable recent-session summary. Only accepted
reviews count; reveals and idempotent retries do not inflate totals. No schema migration
is required.

For responsive browser checks, install Playwright and its Chromium browser (or set
`PLAYWRIGHT_CHANNEL=chrome` to use installed Chrome). Run the local app against a
seeded disposable test database, then run
`PROGRESS_BASE_URL=http://127.0.0.1:8813 SHARED_PASSWORD=your-test-password node scripts/progress-rendered.cjs`.
The check covers Home and Progress at 320/390/1280px in all three interface languages,
keyboard focus, touch targets, horizontal overflow, and browser errors.

## Practice unit selection

Every card requires a valid unit, whether created manually or imported. The library remains shared and fully browsable. Learners choose units and card types directly in practice setup using **With filters**. No units are assigned through profile settings, and leaving session unit filters empty uses the shared library. New units are immediately available for session selection. Session filters apply to random, difficult and mixed selection, including mixed fallback; learning records remain specific to each profile and direction.

Migration `e13f44d6a005` assigns previously unassigned cards to a new «Χωρίς ταξινόμηση» unit without changing their IDs or review history. Follow-up migration `f24a55e7b006` removes the superseded profile-unit preferences while preserving cards, required unit references and historical reviews. The vocabulary fields remain Italian and Greek; this feature adds no new language pairs.

## Bulk vocabulary actions

In Vocabulary, choose **Select cards** to select individual cards or all cards currently displayed on the page. Selection is local and needs no selection API request. Changing pages or filters clears the selection, so actions never include cards selected on another page. **Move to unit** changes only the selected cards’ unit and preserves their IDs, other fields and learning history. **Delete selected** requires explicit confirmation and protects reviewed cards. Reviewed or unavailable cards are automatically removed from the deletion selection, leaving the other cards selected. A notice explains the adjustment, and deletion of the remaining cards requires confirmation again. If every selected card is blocked, nothing is deleted. These actions affect the shared vocabulary library.
