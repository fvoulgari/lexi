# Multilingual acceptance matrix (v1.4.0 work; no release published)

This is the acceptance record for [issue #100](https://github.com/fvoulgari/lexi/issues/100), its language-agnostic follow-ups, and the catalogue/CSV expansion in [issue #143](https://github.com/fvoulgari/lexi/issues/143). The product rules were confirmed before child issues #101–#106 were implemented; #115–#121 shipped the registry-backed model, #122 published the [developer runbook](language-extension-runbook.md) and [final verification record](language-architecture-verification.md), and #143 expanded and verified the current behaviour. This is a specification and verification record, not an authorisation to deploy or publish a release.

The curated, publicly available learning languages are the 35 registry rows listed in the [runbook](language-extension-runbook.md) (`ar`, `bn`, `bg`, `ca`, `cs`, `da`, `de`, `el`, `en`, `es`, `fa`, `fi`, `fr`, `he`, `hi`, `hu`, `id`, `it`, `ja`, `ko`, `nl`, `no`, `pl`, `pt`, `ro`, `ru`, `sk`, `sv`, `sw`, `th`, `tr`, `uk`, `ur`, `vi`, `zh`). `it`, `el` and `da` are enhanced; the rest are basic. The registry may contain backend-supported rows that are deliberately not advertised. Interface language (Greek, English, Italian) is independent of them. “CSV v2/v3” name file formats; **v1.4.0** names planned work, not a published release.

## Rules

| ID | Confirmed rule |
| --- | --- |
| R1 | Any supported language pairs with any other supported language, derived from one registry. Users supply both texts; no automatic translation. |
| R2 | Each Collection has one explicit unordered pair. Cards carry explicit language IDs, may join multiple compatible Collections without duplication, and reversed pair order is compatible. Base/Learning orientation is an explicit UI/destination choice and never mutates the pair, cards, progress, permissions or shared/public collections; a public collection is usable in either orientation. |
| R3 | Practice supports both directions. Progress is per learner, card and direction, shared across compatible Collections. Interface language stays independent. |
| R4 | Cards share common fields plus optional grammar keyed by language ID. Italian/Greek definitions and values are preserved; Danish is enhanced and structured-only (`common`/`neuter`, plural, example, pronunciation); all other curated languages use common fields only and reject submitted grammar. No new vocabulary columns are introduced. |
| R5 | A populated Collection cannot change pair; an empty one can. A card's language IDs cannot change. Practice direction can change. |
| R6 | CSV v2 round-trips language IDs and preserves card IDs and progress; pair-scoped and historical registry-wide v2 files are both accepted; v3 preserves full structured grammar with a versioned metadata cell and rejects cell/metadata conflicts; the simple Base/Learning template maps by chosen orientation; v1 files remain importable; UTF-8/BOM, escaping, bounds and preview-before-confirm are shared by all formats. |
| R7 | Existing Italian–Greek IDs, content, memberships, reviews, sessions, progress, old reversed snapshots and explicit legacy direction IDs are unchanged. |
| R8 | Backend, rendered-page and browser tests cover 35 curated languages, generic and legacy pairs, Danish grammar, RTL text, a synthetic registry-only language, and both practice directions. |
| R9 | Spec, ADRs, glossary, runbook and user docs match the 35-language curated registry; no production migration, deployment or release publication is part of this work. |
| R10 | Base and Learning are searchable comboboxes over the one registry, with accent-tolerant English/native-name/alias matching, popular and recent choices, keyboard support and usable layout at 320/390/760 px; no generated all-pairs dropdown or second language list. |
| R11 | Import asks for destination, recognises the format, shows the explicit Base→Learning mapping and a concise preview that includes structured grammar, shares validation between preview and confirm, and never claims a partial import was cancelled or complete. |
| R12 | Expansion uses one additive registry-only migration; it does not rewrite cards, progress, permissions or direction IDs, and downgrade refuses while expanded languages are referenced. |
| R13 | No second registry, grammar system, vocabulary model, vocabulary columns, or destructive migration is introduced. |

## Resolved decisions

- Standard Vocabulary card creation stays Italian–Greek; other pairs are created and edited in the Collections workspace.
- Collection CSV export uses pair-scoped format v2 by default, v3 on request, and the simple template for manual authoring; v1 and historical wide v2 files remain importable.
- Grammar has common fields plus definitions for Italian, Greek and Danish only. Danish fields have no compatibility columns and live in the existing structured `grammar` JSON. Adding an enhanced language is a configuration addition; adding a basic language is a registry data change.
- Card language IDs are immutable after creation; a different pair means a new card. Practice direction and Base/Learning UI orientation remain changeable.
- A new collection created from CSV starts empty unless a source collection supplies its orientation; otherwise the learner must choose Base and Learning explicitly.

## Test mapping

| Rule | Backend: pytest + real PostgreSQL | Frontend: Vitest + Testing Library | Browser / evidence |
| --- | --- | --- | --- |
| R1 | `test_languages.py`, `test_language_catalogue.py`, `test_language_registry_integrity.py`, `test_universal_languages.py`, `test_card_language_mapping.py` | `languages.test.js`, `LanguagePicker.test.jsx`, `universal-languages.test.jsx`, `SharedCollections.test.jsx` | `collections.mjs` creates cards in the generic workspace against the real API; `language-picker.mjs` searches the full curated picker. No translation feature exists to exercise. |
| R2 | `test_collection_pair_rules.py`, `test_languages.py`, `test_shareable_collections.py` | `SharedCollections.test.jsx`, `languages.test.js`, `Import.test.jsx` | `collection-csv-flow.mjs` round-trips reversed membership with stable `entry_id`; `collections.mjs` adds existing cards to compatible Collections and opens public collections in both orientations. |
| R3 | `test_generic_directions.py`, `test_shareable_collections.py`, `test_progress.py` | `SharedCollections.test.jsx`, `Progress.test.jsx`, `Practice.test.jsx`, `App.test.jsx` | `collections.mjs` and `collection-review.mjs` practise both directions at desktop and mobile widths. |
| R4 | `test_common_card_fields.py`, `test_structured_grammar.py`, `test_danish_grammar.py`, `test_grammar.py` | `grammar.test.js`, `PracticeCardView.test.jsx`, `PracticeCardView.generic.test.jsx`, `CardFields` coverage | `collection-review.mjs` keeps Italian/Greek grammar visible through Vocabulary, CSV and both legacy practice screens; Danish coverage is in the targeted and full backend suites. |
| R5 | `test_collection_pair_rules.py`, `test_card_language_mapping.py`, `test_generic_directions.py` | `SharedCollections.test.jsx`, `languages.test.js`, `Import.test.jsx` | `collections.mjs` exercises pair selection, empty-Collection creation and direction controls through the real API; row manifests guard stored IDs. |
| R6 | `test_csv_v2.py` (scoped/wide v2, v3, simple, BOM, formula, metadata guard), `test_collection_csv_flow.py`, `test_imports.py`, `test_export.py` | `Import.test.jsx`, `ImportPreview.test.jsx`, `Export.test.jsx`, `SharedCollections.test.jsx` | `collection-csv-flow.mjs` exports and re-imports `en/da` and `en/el`, checks stable IDs, Unicode, formula safety, duplicates and missing-text errors at 1280, 390 and 320 px. |
| R7 | `test_languages.py`, `test_card_language_mapping.py`, `test_collections_migration.py`, `test_legacy_collection_migration.py`, `test_card_language_migration.py`, rehearsal manifests | `PracticeCardView.test.jsx`, `Progress.test.jsx`, `SharedCollections.test.jsx` | `collection-review.mjs` creates a workspace card, finds it in Vocabulary/CSV and practises both legacy directions; rehearsal fingerprints cover real legacy rows. |
| R8 | Full backend suite: 1675 passed, 1 skipped | Full Vitest suite: 328 passed in 33 files | `pwa`, `mobile`, `rtl`, `language-picker`, `auth-ui`, `account-ui`, `collections`, `collection-review`, `collection-csv-flow`; screenshots under `docs/images/multilingual-architecture/`. |
| R9 | Ruff and `compileall` clean; Alembic single head `c4d5e6f70819` | ESLint clean; production build green with existing chunk-size warning | [Current verification](language-architecture-verification.md) records docs, ADRs, browser results and the unchanged no-production/no-publication status. |
| R10 | Registry metadata coverage in `test_language_catalogue.py` / `test_languages.py` | `LanguagePicker.test.jsx`, `languages.test.js` | `language-picker.mjs` passes at 320/390/760 px with no page errors; popular/recent selections and keyboard focus are exercised. |
| R11 | Preview/confirm share `app/imports.py` parsing | `Import.test.jsx`, `ImportPreview.test.jsx` | `collection-csv-flow.mjs` confirms the full file; cancellation and destination changes are covered by unit and browser checks. |
| R12 | Rehearsal from frozen v1.3.0 dump: 15 tables / 1352 legacy rows unchanged, `a47c39f0a019 → c4d5e6f70819` | No frontend state migration | Disposable databases only; downgrade guard checked in the migration. |
| R13 | Source review: one registry, one grammar definition file, one `grammar` column | Source review: shared `LanguagePicker`, shared `grammar.js` adapter | No new vocabulary columns, second registry or generation path; docs and ADRs updated. |

## How to reproduce

Use a disposable database whose name ends in `_test`:

```sh
make test-db-up
make test-backend PYTEST_ARGS="-k 'languages or card_language or pair_rules or generic_directions or common_card_fields or danish or csv_v2'"
make test-frontend
make lint
make build
make test-db-down
```

The full backend suite, frontend checks, browser suites and migration rehearsal are recorded in [language-architecture-verification.md](language-architecture-verification.md). The Collections browser suites require a loopback-only fixture and disposable database as described in [collection verification](shareable-collections-verification.md#reproduction); they are not part of the default `make check`.
