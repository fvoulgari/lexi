# Collection verification — 5 November 2026

## Results

| Check | Result |
| --- | --- |
| Full backend suite | PASS: 187 tests; one opt-in real authentication Core test skipped |
| Frontend suite | PASS: 267 tests in 21 files |
| Ruff lint and format | PASS |
| ESLint | PASS |
| Production frontend build | PASS; existing >500 kB chunk warning remains |
| Real local API + PostgreSQL browser acceptance | PASS at 1280, 390 and 320 px; no horizontal overflow |
| Managed-provider / staging / production checks for this feature | NOT RUN; no deployment requested or performed |
| Hosted CI | NOT RUN at preparation time; report actual PR checks separately |

Backend tests use the separate disposable PostgreSQL 17.11 database
`lexi_collections_test`. Browser tests use `lexi_collections_browser_test`,
Chromium, the built frontend and real FastAPI/SQLAlchemy code. Only verified
provider identity is replaced by a deliberately local-only fixture. The fixture
requires an explicit test flag, a loopback database and an `_test` database name,
and is not copied into the production image. No real account, learner data,
provider credential or hosting resource is used.

The full suite retains a pre-existing Starlette/httpx deprecation warning and
some existing frontend MSW handler warnings. Passing local tests do not establish
managed-provider acceptance or CI success. The provider integration test remains
explicitly skipped because no local Core was started for this collection change.

## Ciao acceptance and authorization

- One `ciao` card referenced by Unit 1 and Greetings retains one stable ID.
- Hard rating while practising Italian → Greek makes that card eligible for
  difficult-only practice from Greetings in the same direction. Greek → Italian
  has separate state; another learner has no difficult state until they review.
- Selecting both collections produces one queue card and `available = 1`.
  Overall progress counts the distinct card once; existing direction-deduplication
  tests also pass. Each collection reads the same learner/card/direction state.
- A second learner discovers and practises the published collection without
  copying cards; private collection/card and foreign progress requests fail.
- Collection ownership gives no card-edit rights. Other learners cannot rename,
  reorder, unpublish or change another creator's collection/card. CSRF checks apply.
- Confirmation is required for private card exposure, including cards added to an
  already published collection and cards created directly there. Stale text or
  collection previews are rejected. Restricted legacy cards cannot be published.
- Corrections appear through references. Withdrawn or archived cards disappear
  from other learners' collection views and new queues; references do not restore
  access. Removing a reference leaves the card intact. Archival and unpublishing
  retain reviews and unique-card history.
- Greek–Italian and English–Danish pair/direction checks pass. Wrong-pair adds
  and wrong-direction reveal/review fail. Identical text on two cards retains
  two independent IDs. Duplicate reference adds remain idempotent.

## Actual migration tests

`test_collections_migration.py` builds the full pre-feature schema through
`b46d77a9d009` in a fresh, uniquely named disposable schema. It inserts original
profiles/accounts, card IDs, collection references, practice sessions, snapshots,
reviews and learning progress, then invokes the real migration.

All original columns and values compare exactly after migration; collections
remain private and card audience/ownership are unchanged. Pair backfill becomes
`el`/`it`, and deterministic membership positions are 0 and 1. A direct SQL
cross-pair membership is rejected by the new database trigger. A second fixture
contains mixed pairs; migration raises with the collection ID before adding
publication columns. Both schemas are cleaned up.

No production backup was inspected or migrated. A real-environment migration and
restore rehearsal is still required before any future deployment; follow the
[reviewed migration and rollback procedure](shareable-collections.md#migration-and-rollback).
Automatic downgrade is intentionally disabled to avoid discarding post-cutover
publications, references or learning history.

## Screenshots

Synthetic local browser evidence, with the existing desktop header/mobile
navigation and notebook palette. Each step is captured after its API action.

| Step | Desktop | Mobile |
| --- | --- | --- |
| Create card | [1280 px](images/collections/create-1280.png) | [390 px](images/collections/create-390.png) |
| Reuse existing card | [1280 px](images/collections/reuse-1280.png) | [390 px](images/collections/reuse-390.png) |
| Explicit publication preview | [1280 px](images/collections/publish-preview-1280.png) | [390 px](images/collections/publish-preview-390.png) |
| Discover published collection | [1280 px](images/collections/discover-1280.png) | [390 px](images/collections/discover-390.png) |
| Practise shared card | [1280 px](images/collections/practice-1280.png) | [390 px](images/collections/practice-390.png) |

## Reproduction

Run backend tests with `TEST_DATABASE_URL` naming a disposable `_test` database;
run frontend `npm test`, `npm run lint` and `npm run build` normally. For browser
acceptance, migrate a separate loopback-only disposable database, then start:

```sh
# Supply DATABASE_URL for that disposable database directly in the local shell.
LEXI_COLLECTION_BROWSER_TEST=1 COOKIE_SECURE=false \
PUBLIC_ORIGIN=http://127.0.0.1:8137 STATIC_DIR="$PWD/frontend/dist" \
PYTHONPATH=backend:backend/tests backend/.venv/bin/uvicorn \
collection_browser_app:factory --factory --host 127.0.0.1 --port 8137 --no-access-log
```

In a second terminal: `cd frontend && node tests/collections.mjs`.
This uses synthetic cookie identities only. Stop the fixture and remove its
separate disposable database afterward. Never expose this test server publicly.
