# Language-architecture verification — 25 November 2026, updated 27 November 2026

This is the final verification record for [issue #122](https://github.com/fvoulgari/lexi/issues/122). It closes the documentation and verification phase after #115–#121 shipped the registry-backed, language-agnostic architecture and #121 added Japanese and Arabic as basic languages. The [developer runbook](language-extension-runbook.md) is the operating guide; the [acceptance matrix](multilingual-acceptance.md) maps rules to tests. The addendum at the end records the 27 November 2026 expansion in [issue #143](https://github.com/fvoulgari/lexi/issues/143).

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

> The following checklist is the historical handoff for #122, when the curated registry had six languages. The addendum below records the current 35-language state for #143.

- [x] Runbook and final verification record published.
- [x] Documentation, ADRs and glossary reconciled with the six-language curated registry and the basic/enhanced distinction.
- [x] Full backend, frontend, lint, compile, build, stub browser and real-API browser checks passed.
- [x] Restored-baseline migration rehearsal passed with unchanged legacy row manifests.
- [x] Known local working-tree issues recorded without modification.
- [x] No production database change, deployment, tag or release publication.
- [ ] Human review and explicit merge/release authorization remain outstanding.

## Addendum — 27 November 2026: expanded catalogue, Danish grammar and CSV formats (#143)

This addendum records the work on branch `multilingual-architecture`, created from `origin/main` at `cd69114` (“Make CSV import template pair-aware v2 (#141)”). It expands the curated registry to 35 languages, replaces the old all-pairs selection with shared searchable Base/Learning pickers, adds Danish structured grammar, fixes pair-scoped CSV v2 export, adds simple and lossless v3 templates, and redesigns CSV import. **No production database was contacted or migrated, no application was deployed, no release tag was created and no release was published.** No branch was merged.

### Scope and boundaries

- One registry drives labels, native names, aliases, scripts, text direction, unordered pairs and all 1190 explicit ordered practice directions. The two legacy direction IDs remain unchanged.
- `c4d5e6f70819_expanded_language_catalogue.py` adds only `languages.native_name` and `languages.aliases` plus new registry rows/directions. It is additive and non-destructive; it does not touch cards, reviews, progress, permissions, shared/public collections or vocabulary columns. Downgrade refuses while an expanded language is referenced.
- Italian and Greek grammar definitions, fields, values and CSV keys are preserved. Danish is a third enhanced definition with `common`/`neuter`, plural, example and pronunciation stored only in the existing structured `grammar` JSON. Basic languages keep common fields only.
- Collection pair identity stays unordered. Changing Base/Learning orientation does not mutate card IDs, texts, progress or permissions; public collections can be used in either orientation.
- CSV v2 export is scoped to the destination pair while historical registry-wide v2 files remain importable. `lexi-simple-v1` maps Base/Learning texts to the chosen orientation, and `italian-notebook-v3` adds `schema_version` plus a whitelisted `grammar` metadata cell.

### Automated checks

| Check | Command / environment | Result |
| --- | --- | --- |
| Full backend suite | project backend virtualenv, disposable local PostgreSQL 16 at `127.0.0.1:55432` | **PASS: 1675 passed, 1 skipped, 1 warning in 257.21s** |
| Backend lint and compile | `ruff check app tests alembic`; `compileall -q app` | PASS |
| Alembic heads / current | `alembic heads`; `alembic current` on the rehearsed database | Single head `c4d5e6f70819`; current `c4d5e6f70819` |
| Frontend unit tests | `npm test` | **PASS: 328 tests in 33 files** |
| Frontend lint | `npm run lint` | PASS |
| Production build | `npm run build` | PASS; existing >500 kB chunk warning only |

The single backend warning is the pre-existing Starlette/httpx deprecation; the skip is the existing opt-in provider test. The bundle-size warning predates this work.

### Browser verification

All suites used `CHROME_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'`. The real-API suites used a loopback-only fixture at `http://127.0.0.1:8137`, `DATABASE_URL=.../lexi_ml_browser_test`, and `COLLECTION_TEST_ORIGIN=http://127.0.0.1:8137`.

| Suite | Widths | Result |
| --- | --- | --- |
| `test:pwa` | desktop/mobile | PASS |
| `test:mobile` | 320, 390, 760 px | PASS |
| `test:language-picker` | 320, 390, 760 px | PASS; three consecutive standalone runs also passed |
| `test:rtl` | 320, 390, 760 px | PASS |
| `auth-ui.mjs` | 1280, 390, 320 px | PASS |
| `account-ui.mjs` | 1280, 390, 320 px | PASS |
| `collections.mjs` | 1280, 390, 320 px | PASS |
| `collection-review.mjs` | 1280, 390 px | PASS |
| `collection-csv-flow.mjs` | 1280, 390, 320 px | PASS |

Screenshots and geometry evidence are under [`docs/images/multilingual-architecture/`](images/multilingual-architecture/) and the ignored local `.scratch/` directory. They cover the searchable picker, mobile navigation, RTL text, import/export dialogs, collection creation and discovery, and auth/account flows. All suites are local loopback checks, not hosted CI.

Two browser/unit issues were found and fixed during verification:

1. `LanguagePicker` option clicks were forwarded by the wrapping `<label>` back to the combobox, reopening the popup and blocking action buttons. Option `mousedown`/`click` now call `preventDefault()` and `stopPropagation()`; the picker suite passes at all three widths with no page errors.
2. The import unit test selected languages by clicking a dynamically filtered option and was flaky under load. It now selects through keyboard `ArrowDown`/`Enter` and asserts the chosen label; the full frontend suite passed repeatedly.

An independent diff review found four more issues, all fixed and covered by regressions before the final rerun:

1. A v2 row that supplied the two legacy language IDs in reverse order stored Italian text under the Greek language ID. Import now canonicalises those IDs exactly as API card creation does, so text follows its explicit language. This also keeps a simple template remapped into a reversed pair correct.
2. Structured-only Danish grammar was persisted but omitted from the preview entry; the preview now carries incoming structured grammar and reads the row's explicit language IDs.
3. v3 metadata could silently overwrite a conflicting `grammar_*` cell. Conflicts are now row errors instead of silent overwrites.
4. `LanguagePicker` nested `role="option"` inside a list-item wrapper. Options are now direct listbox children, with headings kept as presentational items.

### Migration rehearsal from a restored baseline

Source: the same owner-only frozen v1.3.0 logical backup used above, at revision `a47c39f0a019`.

```sh
shasum -a 256 /Users/fotiniv/Documents/Projects/lexi/.scratch/protected-recovery/lexi-v130-frozen.eEtPUI/lexi-v130-frozen.dump
# 30b050a5fe8ae2ac701309147235d00c7d151ea76e11b296183e27ca3a8ffc65  lexi-v130-frozen.dump
```

The dump was restored only into disposable loopback databases. Baseline-scoped manifests were generated from `lexi_ml_pre`, `lexi_ml_migrated` and `lexi_ml_replay` and compared:

```text
pre vs migrated:      legacy row manifest: PASS (15 tables, 1352 rows unchanged)
                      revision: a47c39f0a019 -> c4d5e6f70819
migrated vs replay:   legacy row manifest: PASS (15 tables, 1352 rows unchanged)
                      revision: c4d5e6f70819 -> c4d5e6f70819
```

Migrated state checked directly:

| Check | Value |
| --- | ---: |
| `languages` rows | 35 |
| Publicly available languages | 35 |
| `practice_directions` rows | 1190 |
| Vocabulary cards | 264 |
| Collections | 5 |
| Review events | 50 |
| Progress rows | 39 |
| `da`, `el`, `it` enhanced | `true` |
| `zh` aliases | `["Mandarin"]` |

No legacy card, review, progress or permission row was rewritten. The two legacy direction IDs were not renumbered; the new revision only inserts rows for newly curated languages.

### Acceptance status

The [acceptance matrix](multilingual-acceptance.md) now maps rules R1–R13 to the tests and evidence above. On that basis the implementation and verification for #143 are complete. Human review and explicit merge/release authorization remain outstanding; this record does not authorize deployment or publication.

### Addendum caveats

- The disposable databases, loopback fixture and browser processes were local only; no hosted CI or production resource was contacted.
- The frozen dump is a historical local logical backup. This rehearsal does not prove managed-provider snapshot restoration or production acceptance.
- The primary checkout at `/Users/fotiniv/Documents/Projects/lexi` remains on another branch with unrelated user work; it was neither modified nor overwritten.
- The backend deprecation warning and frontend bundle-size warning are pre-existing and remain visible.
