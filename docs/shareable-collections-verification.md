# Collection verification — 6 November 2026

## Results

| Check | Result |
| --- | --- |
| Full backend suite | PASS: 193 tests; one opt-in real authentication Core test skipped |
| Frontend suite | PASS: 275 tests in 21 files |
| Ruff lint and format | PASS |
| ESLint | PASS |
| Production frontend build | PASS; existing >500 kB chunk warning remains |
| Real local API + PostgreSQL browser acceptance | PASS at 1280, 390 and 320 px; no horizontal overflow |
| Managed-provider / staging / production checks for this feature | NOT RUN; no deployment requested or performed |
| Hosted CI | NOT RUN: workflow targets PRs against main; this draft targets the authentication branch |

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

## Review regression evidence

The three review findings were reproduced before fixing them with
`pytest backend/tests/test_collection_review_regressions.py -q`: last-grant
withdrawal returned HTTP 200 instead of 404, a workspace card was missing from
Vocabulary, and editing a shared card with its private unit returned 422.
All six expanded tests now pass. They cover unpublish/delete/reference removal,
B's published reference failing to extend access, direct reads/search/CSV/queues,
existing session and summary redaction, republishing with B's existing difficulty,
combined queue deduplication, unique totals, and private unit/tag isolation.

Frontend regressions exercise both practice renderers in both directions,
including old reversed snapshots, plus correctly labelled create-card language
IDs and the distinction between lost and retained access in unpublish preview.
Real Chromium acceptance (`frontend/tests/collection-review.mjs`) passed at
1280 and 390 px using the actual local API/database: create a card in the
workspace, find the same card in Vocabulary/CSV, save it in the existing editor
while shared, practise in both screens/directions, remove creator grants despite
B's published reference, and restore B's difficulty by republishing. The original
collection browser flow also passes at 1280, 390 and 320 px.

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

The same real-migration test also advances the prior draft through
`d68f99c1f011`. It verifies that draft-owned permanent publication becomes
private with no inferred grants, an independent unowned published library card
stays published, and both references remain. Reversed text slots normalize in
place; IDs, ownership, Italian/Greek grammar, session snapshots and learner/card/
direction progress stay intact. See the migration notes for the explicit
pre-feature unowned-library provenance assumption and out-of-band data review.

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
| Unpublish impact preview | [1280 px](images/collections/unpublish-preview-1280.png) | [390 px](images/collections/unpublish-preview-390.png) |
| Existing Practice screen | [1280 px](images/collections/legacy-practice-1280.png) | [390 px](images/collections/legacy-practice-390.png) |

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

In a second terminal: `cd frontend && node tests/collections.mjs`, then
`node tests/collection-review.mjs` for the review-specific acceptance flow.
This uses synthetic cookie identities only. Stop the fixture and remove its
separate disposable database afterward. Never expose this test server publicly.

## Collection visibility controls — 7 November 2026

- Removed Audience from the Vocabulary card form. New cards can select an owned,
  compatible collection or remain unassigned/private. Published destinations show
  the actual new card text and require explicit exposure confirmation. Changing
  text clears that confirmation. Ordinary edits contain no visibility/ownership
  instruction and do not change collection membership or progress.
- Create collection defaults to Private. Public is a request to review publication:
  the collection is created privately, its server-generated preview is shown, and
  only explicit confirmation publishes it. Cancelling keeps it private.
- Edit collection exposes the owner's Private/Public switch. Both publication and
  withdrawal use the existing preview/confirmation endpoints; other learners
  receive no edit action. Backend ownership checks remain authoritative.
- Added atomic create-and-reference support to the vocabulary HTTP request. Owner,
  language pair and confirmation checks happen in the same transaction; failed
  checks create neither card nor reference. The HTTP command fields are deliberately
  separate from the CSV content schema. No database migration added.
- Existing last-owner-grant, republishing/difficulty, combined-queue, private metadata,
  two-user and history regressions remain passing. Cards are not independently
  published by these controls.

Final checks: **194 backend passed, 1 opt-in Core test skipped; 280 frontend
passed; Ruff, ESLint, frontend build and diff whitespace checks passed.** Existing
Starlette/httpx deprecation and bundle-size warnings remain. The initial full suite
caught CSV schema coupling; separating the HTTP request from CSV content resolved
it before the final passing run. Provider identity remains synthetic, not hosted.

Local real-browser checks at 1280×900 and 390×844 confirmed default Private,
owner Edit collection, card exposure preview, completed Public→Private transition,
no card Audience control and readable collection selection. Mobile document width
was 390px for a 390px viewport. The loopback fixture and disposable database were
removed after verification. Authentication infrastructure was not changed.

| Final screen | Evidence |
| --- | --- |
| Create collection (Private default) | [Desktop](images/collections/visibility-create-desktop.png), [Mobile](images/collections/visibility-create-mobile.png) |
| Edit collection owner toggle | [Desktop](images/collections/visibility-edit-desktop.png) |
| Publication exposure | [Desktop](images/collections/visibility-public-preview-desktop.png) |
| Withdrawal impact | [Mobile](images/collections/visibility-private-preview-mobile.png) |
| Card collection choice, no Audience | [Desktop](images/collections/card-collection-desktop.png), [Mobile](images/collections/card-collection-mobile.png) |
