# Universal languages verification

Issue #121 registers Japanese (`ja`) and Arabic (`ar`) as curated **basic** languages through the language registry only. No new grammar definition, card column, migration-owned business rule, React component, CSS branch, or per-language frontend list is needed.

> Historical record for #121. [Issue #143](https://github.com/fvoulgari/lexi/issues/143) later expanded the curated registry to 35 languages and added Danish grammar; see the [current verification record](language-architecture-verification.md).

## What was verified

### Data-only registration

- A fresh PostgreSQL database upgraded from the previous Alembic head `b7c9d1e4f206` to the new head `a1b2c3d4e5f6`.
- The fresh registry contains:
  - `ja`, label Japanese, script `Jpan`, direction `ltr`, `enhanced = false`, public.
  - `ar`, label Arabic, script `Arab`, direction `rtl`, `enhanced = false`, public.
- Every ordered direction involving `ja` or `ar` exists, including `ja/en`, `ar/en`, `ja/ar`, and the reversed directions. The legacy `el/it` keys stay unchanged.
- The data-only migration edits registry rows only. It adds no column and no grammar definition. It refuses to downgrade while production-style card/collection rows still reference `ja` or `ar`.
- Fresh install uses the same central catalogue (`backend/app/language_catalogue.json`) as the migration, so new databases and upgraded databases converge.

### End-to-end backend coverage

`backend/tests/test_universal_languages.py` and the expanded existing suites prove:

- `ja/en`, `ar/en`, `ja/ar`, another Latin pair (`en/da`), and legacy `el/it` create collections and cards in both directions.
- Unicode Japanese and Arabic text survives card authoring, search, progress, and bidirectional review.
- Basic-language cards have no grammar object, and submitting language-keyed grammar for a basic language is rejected as invalid input.
- Collection publication preview, visibility, and saving work with universal pairs.
- CSV v2 headers are derived from the current registry. Unicode `ja`/`ar` rows round-trip through export, preview, and confirm with progress and identity preserved.
- A synthetic language (`zz`) inserted with only registry SQL rows (hidden from the public catalogue) works through cards, progress, CSV columns, preview, and confirm without any application code change.

`backend/tests/test_csv_v2.py`, `test_generic_directions.py`, `test_language_catalogue.py`, and `test_languages.py` were expanded for the new curated set and paired directions.

The browser fixtures were restored for the registry-aware app markup introduced by #118–#120. `frontend/tests/mobile-navigation.mjs` was fixed on `main` by #131; this branch only needs the matching `/api/languages` stub in `frontend/tests/pwa.mjs`. This is test-only repair, not a language feature or production code change.

### Frontend coverage

`frontend/src/universal-languages.test.jsx` proves that, when `/api/languages` supplies `ja`, `ar`, or a synthetic row:

- The registry picker exposes the new languages and their ID/label/metadata come straight from the API.
- Collection authoring shows only common fields for basic languages and preserves Unicode text.
- Legacy `el/it` still renders grammar fields.
- Card preview and practice use the prompt/answer language of each direction (`ltr` for Japanese, `rtl` for Arabic).
- A synthetic registry-only row alone drives picker and authoring, including RTL metadata.

No production frontend source was changed for the new languages. The existing shared styles already cover `Arab` and `Jpan`, and #120 role/script-based text attributes carry direction to every text surface.

## Commands

Backend (from `backend/`):

```sh
TEST_DATABASE_URL='postgresql+psycopg://postgres:lexi-test-only@127.0.0.1:55434/lexi_121_test' .venv/bin/pytest -q
.venv/bin/python -m ruff check app tests alembic/versions/a1b2c3d4e5f6_universal_languages.py
DATABASE_URL='postgresql+psycopg://postgres:lexi-test-only@127.0.0.1:55434/lexi_121_fresh_test' .venv/bin/alembic upgrade head
.venv/bin/alembic heads  # single head: a1b2c3d4e5f6
```

Frontend (from `frontend/`):

```sh
npm test
npm run lint
npm run build
npm run test:pwa
npm run test:mobile
npm run test:language-picker
npm run test:rtl
```

## Result

- Backend: 476 passed, 3 skipped.
- Ruff: clean.
- Single Alembic head: `a1b2c3d4e5f6`.
- Fresh upgrade: correct six-language public registry and all new ordered directions.
- Frontend: 327 tests passed; lint and production build clean.
- Browser: PWA, mobile navigation, language picker, and RTL suites pass at 320/390/760px.

These are the #121 results. The final #122 run records 328 frontend tests and the additional browser and migration-rehearsal evidence in [final language-architecture verification](language-architecture-verification.md).

This change registers languages and makes CSV exchange registry-driven. It does not deploy, migrate production, create a release tag, or publish a release.
