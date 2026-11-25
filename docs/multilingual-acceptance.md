# Multilingual acceptance matrix (v1.4.0 work; no release published)

This is the acceptance record for [issue #100](https://github.com/fvoulgari/lexi/issues/100) and its language-agnostic follow-ups. The product rules were confirmed before child issues #101–#106 were implemented; #115–#121 shipped the registry-backed model, and #122 publishes the [developer runbook](language-extension-runbook.md) and [final verification record](language-architecture-verification.md). It is a specification and verification record, not an authorisation to deploy or publish a release.

Curated, publicly available learning languages are `ar`, `da`, `el`, `en`, `it`, `ja` (registry-backed; `it`/`el` enhanced, the rest basic). The registry may contain backend-supported rows that are deliberately not advertised. Interface language (Greek, English, Italian) is independent of them. “CSV v2” names a file format; **v1.4.0** names planned work, not a published release.

## Rules

| ID | Confirmed rule |
| --- | --- |
| R1 | Any supported language pairs with any other supported language, derived from one registry. Users supply both texts; no automatic translation. |
| R2 | Each Collection has one explicit pair. Cards carry explicit language IDs, may join multiple compatible Collections without duplication, and reversed pair order is compatible. Texts map by language ID, not position. |
| R3 | Practice supports both directions. Progress is per learner, card and direction, shared across compatible Collections. Interface language stays independent. |
| R4 | Cards share common fields plus optional grammar keyed by language ID. Italian/Greek definitions are preserved; Arabic, Danish, English and Japanese use common fields only and reject submitted grammar. Adding a basic language needs no new text or grammar columns. |
| R5 | A populated Collection cannot change pair; an empty one can. A card's language IDs cannot change. Practice direction can change. |
| R6 | CSV v2 round-trips language IDs and preserves card IDs and progress; v1 files remain importable; mismatched or missing texts are rejected. |
| R7 | Existing Italian–Greek IDs, content, memberships, reviews, sessions, progress and old reversed snapshots are unchanged. |
| R8 | Backend, rendered-page and browser tests cover `en↔da`, `ja/en`, `ar/en`, `ja/ar`, RTL text, a synthetic registry-only language and legacy `el↔it` journeys. |
| R9 | Spec, ADRs, glossary and user docs match the six-language curated registry; no production migration, deployment or release publication is part of this work. |

## Resolved decisions

- Standard Vocabulary card creation stays Italian–Greek; other pairs are created and edited in the Collections workspace.
- Collection CSV export uses format v2 for all pairs; v1 files remain importable.
- Grammar has common fields plus definitions only for Italian and Greek; Arabic, Danish, English and Japanese use common fields only. Adding an enhanced language is a configuration addition; adding a basic language is a registry data change.
- Card language IDs are immutable after creation; a different pair means a new card. Practice direction remains changeable.

## Test mapping

| Rule | Backend: pytest + real PostgreSQL | Frontend: Vitest + Testing Library | Browser / evidence |
| --- | --- | --- | --- |
| R1 | `test_languages.py::test_registry_accepts_every_ordered_pair_and_rejects_identical`, `test_labels_come_from_the_registry`; `test_language_catalogue.py`, `test_language_registry_integrity.py`, `test_universal_languages.py`; `test_card_language_mapping.py::test_every_ordered_pair_exposes_ids_and_text_by_language_id`, `test_invalid_card_language_ids_are_rejected` | `languages.test.js`, `LanguagePicker.test.jsx`, `universal-languages.test.jsx`; `SharedCollections.test.jsx` (“an en/da workspace derives controls from the registry and creates cards by language ID”) | `frontend/tests/collections.mjs` creates cards in the generic workspace against the real API; `frontend/tests/language-picker.mjs` checks the searchable curated picker. No translation feature exists to exercise. |
| R2 | `test_collection_pair_rules.py::test_reversed_pair_card_is_reused_across_collections`, `test_wrong_pair_add_fails_in_api_and_database`; `test_languages.py::test_text_maps_by_explicit_language_id`, `test_reversed_legacy_snapshot_text_follows_its_own_language_ids` | `SharedCollections.test.jsx` (`en/el` language-ID text mapping, reversed legacy `el/it` snapshot); `languages.test.js` (“pairs are unordered and legacy identity is explicit”) | `frontend/tests/collection-csv-flow.mjs` round-trips reversed membership with stable `entry_id`; `collections.mjs` adds existing cards to compatible Collections. |
| R3 | `test_generic_directions.py::test_both_directions_round_trip_for_supported_pairs`, `test_direction_switch_and_review_replay_keep_progress_separate`, `test_shared_progress_is_per_learner_across_compatible_collections`; `test_shareable_collections.py::test_language_pair_order_and_no_text_merging`; `test_progress.py` direction isolation | `SharedCollections.test.jsx` (`en/el` practice in both directions with explicit `lang`); `Progress.test.jsx` generic direction labels and links; `Practice.test.jsx` direction switching; `App.test.jsx` interface-language independence | `collections.mjs` and `collection-review.mjs` practise both legacy directions at desktop and mobile widths. |
| R4 | `test_common_card_fields.py::test_definitions_only_cover_italian_and_greek`, `test_legacy_grammar_round_trips_with_the_same_card_id`, `test_common_only_languages_require_no_gender_and_expose_common_fields`, `test_mixed_pair_validates_only_the_defined_language`; `test_structured_grammar.py` (definition-driven fields and a test-only definition with no new column); `test_universal_languages.py` (basic-language grammar rejected); `test_grammar.py` legacy corrections | `grammar.test.js` (language-keyed definitions, test-only definition needs no component); `PracticeCardView.generic.test.jsx` (common-only and mixed-pair rendering); `CollectionCardForm.test.jsx`, `VocabularyForm.test.jsx` (shared fields) | `collection-review.mjs` keeps Italian/Greek grammar visible through Vocabulary, CSV and both legacy practice screens; `universal-languages.test.jsx` shows `ja`/`ar` and a synthetic row with common fields only. |
| R5 | `test_collection_pair_rules.py::test_populated_pair_change_fails_in_api_and_database`, `test_empty_pair_change_succeeds_and_applies_to_new_cards`; `test_card_language_mapping.py::test_card_language_order_is_immutable`; `test_common_card_fields.py::test_card_language_ids_cannot_be_changed_after_creation`; `test_generic_directions.py::test_direction_switch_and_review_replay_keep_progress_separate` | `SharedCollections.test.jsx` generic direction controls and create-card language selectors; `languages.test.js` (“labels come from ordered language IDs, not legacy key names”) | `collections.mjs` exercises pair selection, empty-Collection creation and direction controls through the real API; database guards are also checked directly in the rehearsal below. |
| R6 | `test_csv_v2.py::test_v2_export_uses_language_keyed_columns_for_every_collection`, `test_v2_round_trip_preserves_identity_progress_and_reversed_membership`, `test_v2_row_errors_are_reported_in_preview`, `test_v1_export_still_available_for_legacy_collections`; `test_collection_csv_flow.py::test_reference_import_preserves_identity_and_does_not_merge_text`; `test_imports.py`, `test_export.py` v1 regressions | `Import.test.jsx`, `ImportPreview.test.jsx`, `Export.test.jsx`, `SharedCollections.test.jsx` language-keyed preview rows and import destinations | `frontend/tests/collection-csv-flow.mjs` exports and re-imports `en/da` and `en/el`, checks stable IDs, Unicode, formula safety, duplicates and missing-text errors at 1280, 390 and 320 px. |
| R7 | `test_languages.py::test_reversed_legacy_snapshot_text_follows_its_own_language_ids`; `test_card_language_mapping.py::test_legacy_vocabulary_keeps_explicit_ids_and_legacy_direction`, `test_reversed_legacy_snapshot_keeps_its_text_and_review_history`; `test_collections_migration.py`, `test_legacy_collection_migration.py`, `test_card_language_migration.py`; disposable rehearsal in [final language-architecture verification](language-architecture-verification.md) | `PracticeCardView.test.jsx`, `PracticeCardView.generic.test.jsx`, `Progress.test.jsx` legacy keys and snapshots | `collection-review.mjs` creates a workspace card, finds the same card in Vocabulary/CSV and practises both legacy directions; rehearsal fingerprints cover real legacy rows. |
| R8 | Same backend files as R1–R7; `test_generic_directions.py`, `test_csv_v2.py` and `test_universal_languages.py` name `en/da`, `en/el`, `ja/en`, `ar/en`, `ja/ar`, a synthetic registry-only pair and legacy `el/it` cases explicitly | `SharedCollections.test.jsx`, `languages.test.js`, `grammar.test.js`, `PracticeCardView.generic.test.jsx`, `text-direction.test.jsx`, `universal-languages.test.jsx` | `collection-csv-flow.mjs` (`en/da`, `en/el`), `collections.mjs` (generic pairs), `collection-review.mjs` (legacy `el/it`), `language-picker.mjs`, `rtl-rendering.mjs` and `pwa.mjs`/`mobile-navigation.mjs`. Browser suites are local loopback checks, not hosted CI. |
| R9 | 476 backend tests passed, 3 skipped; Ruff and compileall clean | 328 frontend tests passed; ESLint and production build clean (existing bundle-size warning) | [Final language-architecture verification](language-architecture-verification.md) records documentation updates, the restored-baseline row-manifest rehearsal, all browser suites and the unchanged no-production/no-publication status. Browser verification also fixed a published-card edit-flow confirmation bug and updated stale selectors after the publication-dialog refactor. |

## How to reproduce

Use a disposable database whose name ends in `_test`:

```sh
make test-db-up
make test-backend PYTEST_ARGS="-k 'languages or card_language or pair_rules or generic_directions or common_card_fields or csv_v2'"
make test-frontend
make lint
make build
make test-db-down
```

The full backend suite, frontend checks, browser suites and migration rehearsal are recorded in [final language-architecture verification](language-architecture-verification.md). The Collections browser suites require a loopback-only fixture and disposable database as described in [collection verification](shareable-collections-verification.md#reproduction); they are not part of the default `make check`.
