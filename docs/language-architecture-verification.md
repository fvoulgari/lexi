# Final language-architecture verification — 25 November 2026

This is the final verification record for [issue #122](https://github.com/fvoulgari/lexi/issues/122). It closes the documentation and verification phase after #115–#121 shipped the registry-backed, language-agnostic architecture and #121 added Japanese and Arabic as basic languages. The [developer runbook](language-extension-runbook.md) is the operating guide; the [acceptance matrix](multilingual-acceptance.md) maps rules to tests.

**No production database was contacted or migrated, no application was deployed, no release tag was created and no release was published.** No branch was merged as part of this verification.

## Checkout and scope

The checks ran in a dedicated Git worktree created from `origin/main`:

```sh
git rev-parse HEAD                 # cd79fce782a2d047679790ea17df4d872e9aa71b
git merge-base HEAD origin/main    # cd79fce782a2d047679790ea17df4d872e9aa71b
```

That commit is PR #132 / #121, “Universal languages (Japanese, Arabic) end-to-end”. The verified change set is limited to:

- reconciliation of `README.md`, `GLOSSARY.md`, `docs/spec.md`, `docs/multilingual-acceptance.md`, `docs/shareable-collections.md`, `docs/csv-format.md`, `docs/v140-release-readiness.md`, and ADRs 0002, 0005, 0006 and 0008;
- the new [runbook](language-extension-runbook.md) and this record;
- one real frontend fix and regression test: exposure confirmation is now scoped to newly created cards in `frontend/src/VocabularyForm.jsx`;
- browser selector updates in `frontend/tests/collections.mjs` and `frontend/tests/collection-review.mjs` after the publication-dialog refactor;
- the deterministic rehearsal helper at [`scripts/migration-rehearsal.py`](../scripts/migration-rehearsal.py).

The canonical [`backend/app/preservation_manifest.py`](../backend/app/preservation_manifest.py) was retained unchanged. The new helper is intentionally separate: the canonical tool reports every key/column change, while the helper compares only tables and columns present in a restored baseline, so additive registry tables and columns are not mistaken for legacy-data rewrites.

## Environment and reproducibility

- Python: the project backend virtual environment at `/Users/fotiniv/Documents/Projects/lexi/backend/.venv`; this worktree has no local `backend/.venv`.
- PostgreSQL: disposable loopback container `notebook-test-postgres-lexi`, bound to `127.0.0.1:55434`. The Makefile default container is `notebook-test-postgres`, so the explicit `TEST_DATABASE_URL` / `DATABASE_URL` override was used.
- Node: project `frontend` dependencies via a local `node_modules` symlink; the symlink is not part of the change set.
- Browser: `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`, used through `CHROME_PATH` for the stub browser suites and the CSV flow suite.
- All application databases were named with a `_test` suffix or were disposable rehearsal databases. No hosted, shared or production database was used.

## Automated checks

### Backend

```sh
TEST_DATABASE_URL='postgresql+psycopg://postgres:lexi-test-only@127.0.0.1:55434/lexi_122_test' \
  /Users/fotiniv/Documents/Projects/lexi/backend/.venv/bin/pytest -q

/Users/fotiniv/Documents/Projects/lexi/backend/.venv/bin/python -m ruff check app tests alembic
/Users/fotiniv/Documents/Projects/lexi/backend/.venv/bin/python -m compileall -q app
```

| Check | Result |
| --- | --- |
| Full pytest suite on disposable PostgreSQL | **PASS: 476 passed, 3 skipped, 1 warning in 149.04s** |
| Ruff on `app`, `tests`, `alembic` | PASS |
| `compileall` on `app` | PASS |
| Alembic heads / current revision | Single head `a1b2c3d4e5f6` |

The single warning is the pre-existing Starlette/httpx deprecation warning; it is not introduced by this work. The three skips are the existing opt-in provider/Core tests.

### Frontend

```sh
cd frontend
npm test
npm run lint
npm run build
```

| Check | Result |
| --- | --- |
| Vitest | **PASS: 328 tests passed (328) in 31 files** |
| ESLint | PASS |
| Production build | PASS; existing >500 kB chunk warning only |

The increase from the #121 run’s 327 tests is the new `VocabularyForm.test.jsx` regression test covering the published-collection edit flow described below.

## Browser verification

### Stub-built UI suites

```sh
cd frontend
CHROME_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' npm run test:pwa
CHROME_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' npm run test:mobile
CHROME_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' npm run test:language-picker
CHROME_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' npm run test:rtl
```

All four passed. They cover installation/cache behavior, mobile navigation, the searchable curated language picker, and RTL/non-Latin rendering supplied through registry data. The RTL suite injects `ar` at runtime, demonstrating that no React component or CSS branch is needed for a basic RTL language.

### Real local API and database suites

A fresh disposable database was migrated to `a1b2c3d4e5f6`. The loopback-only fixture used:

```sh
LEXI_COLLECTION_BROWSER_TEST=1 COOKIE_SECURE=false \
PUBLIC_ORIGIN=http://127.0.0.1:8137 STATIC_DIR="$PWD/frontend/dist" \
PYTHONPATH=backend:backend/tests \
DATABASE_URL='postgresql+psycopg://postgres:lexi-test-only@127.0.0.1:55434/lexi_122_browser_test' \
/Users/fotiniv/Documents/Projects/lexi/backend/.venv/bin/uvicorn \
collection_browser_app:factory --factory --host 127.0.0.1 --port 8137 --no-access-log
```

Then, from `frontend/`:

```sh
CHROME_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' node tests/collections.mjs
CHROME_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' node tests/collection-review.mjs
CHROME_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' node tests/collection-csv-flow.mjs
```

| Suite | Widths | Result |
| --- | --- | --- |
| `collections.mjs` | 1280, 390, 320 px | PASS |
| `collection-review.mjs` | 1280, 390 px | PASS |
| `collection-csv-flow.mjs` | 1280, 390, 320 px | PASS |

These suites exercise generic and legacy pairs through the real API: card creation and reuse, publication preview/confirmation/unpublish, saved-collection discovery, explicit exposure confirmation for new cards, both practice directions, review and progress behavior, and CSV v2 export/import with stable IDs, Unicode, formula escaping, duplicates and missing-text errors. They are local loopback checks, not hosted CI.

### Browser findings fixed during verification

1. **Real edit-flow bug:** cached collection data made `needsExposure` true when editing an already published card, but the exposure checkbox is rendered only for new cards. The save guard and disabled state now both scope the confirmation to cards without an ID. A regression test proves that such an edit saves without a `confirm_collection_exposure` payload. New cards still require explicit confirmation.
2. **Stale selectors:** browser tests were updated for the current UI after the publication-dialog refactor: `region` → `dialog`, the confirm label → `Publish`, the collection filter → an accessible combobox, and the collection `Open` link → the `Details` button where the current UI uses it.

All browser suites were rerun after those changes.

## Migration rehearsal from a restored baseline

Source: the owner-only frozen v1.3.0 logical backup retained locally at revision `a47c39f0a019`.

```sh
shasum -a 256 /Users/fotiniv/Documents/Projects/lexi/.scratch/protected-recovery/lexi-v130-frozen.eEtPUI/lexi-v130-frozen.dump
# 30b050a5fe8ae2ac701309147235d00c7d151ea76e11b296183e27ca3a8ffc65  lexi-v130-frozen.dump
```

The dump was restored only into newly created disposable databases in the loopback PostgreSQL container. No provider snapshot, hosted database or production database was used. Manifests were written to a temporary directory, not committed.

```sh
DB='postgresql+psycopg://postgres:lexi-test-only@127.0.0.1:55434'
PYTHON=/Users/fotiniv/Documents/Projects/lexi/backend/.venv/bin/python

# Baseline restore and deterministic manifest.
$PYTHON scripts/migration-rehearsal.py manifest "$DB/lexi_122_pre" > pre.json

# Restore a second copy, then upgrade both databases to head.
$PYTHON scripts/migration-rehearsal.py manifest "$DB/lexi_122_restored" > restored.json
# alembic upgrade head on lexi_122_restored and lexi_122_migrated
$PYTHON scripts/migration-rehearsal.py manifest "$DB/lexi_122_migrated" --baseline pre.json > migrated.json

# Replay the same baseline into a third database, migrate again, and compare.
$PYTHON scripts/migration-rehearsal.py manifest "$DB/lexi_122_replay" --baseline pre.json > replay.json

$PYTHON scripts/migration-rehearsal.py compare pre.json migrated.json
# legacy row manifest: PASS (15 tables, 1352 rows unchanged)
# revision: a47c39f0a019 -> a1b2c3d4e5f6

$PYTHON scripts/migration-rehearsal.py compare migrated.json replay.json
# legacy row manifest: PASS (15 tables, 1352 rows unchanged)
# revision: a1b2c3d4e5f6 -> a1b2c3d4e5f6
```

`alembic heads` and `alembic current` both reported the single current head `a1b2c3d4e5f6`. The baseline and replay manifests also matched exactly before migration. Only `alembic_version` advanced; the baseline tables and columns retained identical row counts and ordered-row digests. Additive registry tables and the structured `grammar` column were reported separately by the baseline-scoped helper rather than treated as rewrites.

The migrated database was checked for the shipped registry state:

| Check | Value |
| --- | ---: |
| `languages` rows | 6 |
| Publicly available languages | 6 |
| `practice_directions` rows | 30 |
| Directions involving `ja` or `ar` | 18 |
| Vocabulary cards | 264 |
| Cards with a structured grammar backfill | 264 |
| Collections | 5 |
| Review events | 50 |
| Progress rows | 39 |

This confirms that `ar` and `ja` are ordinary basic language rows, that every ordered public pair exists, and that no legacy card, review or progress row was rewritten. The earlier historical rehearsal is recorded in [v1.4.0 readiness](v140-release-readiness.md).

## Regression evidence map

The [acceptance matrix](multilingual-acceptance.md#test-mapping) contains the full rule-to-test mapping. The areas called out in #122 are covered as follows:

| Area | Evidence |
| --- | --- |
| Italian/Greek grammar unchanged | `test_structured_grammar.py`, `test_common_card_fields.py`, `test_grammar.py`, `grammar.test.js`, `collection-review.mjs`; 264 legacy grammar backfills in the rehearsal; definitions remain data-only in `backend/app/grammar_definitions.json`. |
| Basic `ja`/`ar` and synthetic registry-only rows | `test_language_catalogue.py`, `test_language_registry_integrity.py`, `test_universal_languages.py`, `universal-languages.test.jsx`, `language-picker.mjs`, `rtl-rendering.mjs`; basic grammar is rejected and no code branch is added. |
| Permissions and visibility | `test_shareable_collections.py`, `test_collection_review_regressions.py`, `collections.mjs`, `collection-review.mjs`; publication preview, explicit new-card exposure confirmation, unpublish impact, withdrawn grants and saved-collection access are exercised through the real API. |
| Saved collections and pair rules | `test_collection_pair_rules.py`, `SharedCollections.test.jsx`, `collections.mjs`; populated pairs stay fixed, empty pairs can change, card language IDs are immutable, and reversed order remains compatible by ID. |
| CSV compatibility | `test_csv_v2.py`, `test_collection_csv_flow.py`, `test_imports.py`, `test_export.py`, `Import.test.jsx`, `ImportPreview.test.jsx`, `Export.test.jsx`, `collection-csv-flow.mjs`; v2 round-trips all public pairs while v1 and unversioned files remain importable. |
| Review and progress isolation | `test_generic_directions.py`, `test_progress.py`, `Progress.test.jsx`, `Practice.test.jsx`, `collection-review.mjs`; both directions of generic and legacy pairs keep separate learner/card/direction progress. |
| Documentation consistency | This record, the [runbook](language-extension-runbook.md), the [acceptance matrix](multilingual-acceptance.md), `README.md`, `GLOSSARY.md`, `docs/spec.md`, `docs/csv-format.md`, `docs/shareable-collections.md` and ADRs 0002, 0005, 0006, 0007 and 0008. |

## Known local caveats

- The worktree lacked `backend/.venv` and `frontend/node_modules`; the existing project virtualenv and a local `node_modules` symlink were used. Neither is part of the committed change set, and the symlink was removed before staging.
- `make test-db-up` targets container `notebook-test-postgres`. The already running `notebook-test-postgres-lexi` on port `55434` was used with explicit URLs instead; no container was reconfigured.
- The original working tree at `/Users/fotiniv/Documents/Projects/lexi` remains on `main` with an unrelated modified `docs/csv-format.md`, many untracked `... 2.*` duplicate files and a CSV fixture directory. Those local files were neither inspected as authoritative evidence nor modified or deleted.
- The frozen backup is a local historical logical backup. This rehearsal does not prove managed-provider snapshot restoration, hosted CI success or production acceptance; a new protected backup and an isolated provider rehearsal remain mandatory before any future cutover.
- Browser acceptance suites are loopback-only and use synthetic identities. They do not contact hosted authentication or production resources.
- The backend deprecation warning and frontend bundle-size warning are pre-existing and remain visible.

## Handoff status

- [x] Runbook and final verification record published.
- [x] Documentation, ADRs and glossary reconciled with the six-language curated registry and the basic/enhanced distinction.
- [x] Full backend, frontend, lint, compile, build, stub browser and real-API browser checks passed.
- [x] Restored-baseline migration rehearsal passed with unchanged legacy row manifests.
- [x] Known local working-tree issues recorded without modification.
- [x] No production database change, deployment, tag or release publication.
- [ ] Human review and explicit merge/release authorization remain outstanding.
