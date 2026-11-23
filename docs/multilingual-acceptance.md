# Multilingual acceptance matrix (v1.4.0)

This is the finalised acceptance record for [issue #100](https://github.com/fvoulgari/lexi/issues/100). The product rules were confirmed before child issues #101–#106 were implemented; those implementations are now merged, and #107 records the matrix against the tests in `main`. It is a specification and verification record, not an authorisation to deploy or publish a release.

Supported learning languages are `da`, `el`, `en` and `it`. Interface language (Greek, English, Italian) is independent of them. “CSV v2” names a file format; **v1.4.0** names the release.

## Rules

| ID | Confirmed rule |
| --- | --- |
| R1 | Any supported language pairs with any other supported language, derived from one registry. Users supply both texts; no automatic translation. |
| R2 | Each Collection has one explicit pair. Cards carry explicit language IDs, may join multiple compatible Collections without duplication, and reversed pair order is compatible. Texts map by language ID, not position. |
| R3 | Practice supports both directions. Progress is per learner, card and direction, shared across compatible Collections. Interface language stays independent. |
| R4 | Cards share common fields plus optional grammar keyed by language ID. Italian/Greek definitions are preserved; English/Danish use common fields only. Adding a language needs no new text columns. |
| R5 | A populated Collection cannot change pair; an empty one can. A card's language IDs cannot change. Practice direction can change. |
| R6 | CSV v2 round-trips language IDs and preserves card IDs and progress; v1 files remain importable; mismatched or missing texts are rejected. |
| R7 | Existing Italian–Greek IDs, content, memberships, reviews, sessions, progress and old reversed snapshots are unchanged. |
| R8 | Backend, rendered-page and browser tests cover `en↔da`, `en↔el` and legacy `el↔it` journeys. |
| R9 | Spec, ADR, glossary, user docs and release materials match the rules; no production migration or release publication is part of this work. |

## Resolved decisions

- Standard Vocabulary card creation stays Italian–Greek; other pairs are created and edited in the Collections workspace.
- Collection CSV export uses format v2 for all pairs; v1 files remain importable.
- Grammar has common fields plus definitions only for Italian and Greek; English and Danish use common fields only.
- Card language IDs are immutable after creation; a different pair means a new card. Practice direction remains changeable.

## Test mapping

| Rule | Backend: pytest + real PostgreSQL | Frontend: Vitest + Testing Library | Browser / evidence |
| --- | --- | --- | --- |
| R1 | `test_languages.py::test_registry_accepts_every_ordered_pair_and_rejects_identical`, `test_labels_come_from_the_registry`; `test_card_language_mapping.py::test_every_ordered_pair_exposes_ids_and_text_by_language_id`, `test_invalid_card_language_ids_are_rejected` | `languages.test.js` (“every supported pair has two distinct directed keys”, “labels come from ordered language IDs, not legacy key names”); `SharedCollections.test.jsx` (“an en/da workspace derives controls from the registry and creates cards by language ID”) | `frontend/tests/collections.mjs` creates cards in the generic workspace against the real API. No translation feature exists to exercise. |
| R2 | `test_collection_pair_rules.py::test_reversed_pair_card_is_reused_across_collections`, `test_wrong_pair_add_fails_in_api_and_database`; `test_languages.py::test_text_maps_by_explicit_language_id`, `test_reversed_legacy_snapshot_text_follows_its_own_language_ids` | `SharedCollections.test.jsx` (`en/el` language-ID text mapping, reversed legacy `el/it` snapshot); `languages.test.js` (“pairs are unordered and legacy identity is explicit”) | `frontend/tests/collection-csv-flow.mjs` round-trips reversed membership with stable `entry_id`; `collections.mjs` adds existing cards to compatible Collections. |
| R3 | `test_generic_directions.py::test_both_directions_round_trip_for_supported_pairs`, `test_direction_switch_and_review_replay_keep_progress_separate`, `test_shared_progress_is_per_learner_across_compatible_collections`; `test_shareable_collections.py::test_language_pair_order_and_no_text_merging`; `test_progress.py` direction isolation | `SharedCollections.test.jsx` (`en/el` practice in both directions with explicit `lang`); `Progress.test.jsx` generic direction labels and links; `Practice.test.jsx` direction switching; `App.test.jsx` interface-language independence | `collections.mjs` and `collection-review.mjs` practise both legacy directions at desktop and mobile widths. |
| R4 | `test_common_card_fields.py::test_definitions_only_cover_italian_and_greek`, `test_legacy_grammar_round_trips_with_the_same_card_id`, `test_common_only_languages_require_no_gender_and_expose_common_fields`, `test_mixed_pair_validates_only_the_defined_language`; `test_grammar.py` legacy corrections | `grammar.test.js` (language-keyed definitions); `PracticeCardView.generic.test.jsx` (common-only and mixed-pair rendering); `VocabularyForm.test.jsx` (shared fields) | `collection-review.mjs` keeps Italian/Greek grammar visible through Vocabulary, CSV and both legacy practice screens. |
| R5 | `test_collection_pair_rules.py::test_populated_pair_change_fails_in_api_and_database`, `test_empty_pair_change_succeeds_and_applies_to_new_cards`; `test_card_language_mapping.py::test_card_language_order_is_immutable`; `test_common_card_fields.py::test_card_language_ids_cannot_be_changed_after_creation`; `test_generic_directions.py::test_direction_switch_and_review_replay_keep_progress_separate` | `SharedCollections.test.jsx` generic direction controls and create-card language selectors; `languages.test.js` (“labels come from ordered language IDs, not legacy key names”) | `collections.mjs` exercises pair selection, empty-Collection creation and direction controls through the real API; database guards are also checked directly in the rehearsal below. |
| R6 | `test_csv_v2.py::test_v2_export_uses_language_keyed_columns_for_every_collection`, `test_v2_round_trip_preserves_identity_progress_and_reversed_membership`, `test_v2_row_errors_are_reported_in_preview`, `test_v1_export_still_available_for_legacy_collections`; `test_collection_csv_flow.py::test_reference_import_preserves_identity_and_does_not_merge_text`; `test_imports.py`, `test_export.py` v1 regressions | `Import.test.jsx`, `ImportPreview.test.jsx`, `Export.test.jsx`, `SharedCollections.test.jsx` language-keyed preview rows and import destinations | `frontend/tests/collection-csv-flow.mjs` exports and re-imports `en/da` and `en/el`, checks stable IDs, Unicode, formula safety, duplicates and missing-text errors at 1280, 390 and 320 px. |
| R7 | `test_languages.py::test_reversed_legacy_snapshot_text_follows_its_own_language_ids`; `test_card_language_mapping.py::test_legacy_vocabulary_keeps_explicit_ids_and_legacy_direction`, `test_reversed_legacy_snapshot_keeps_its_text_and_review_history`; `test_collections_migration.py`, `test_legacy_collection_migration.py`, `test_card_language_migration.py`; disposable rehearsal in [v1.4.0 release readiness](v140-release-readiness.md) | `PracticeCardView.test.jsx`, `PracticeCardView.generic.test.jsx`, `Progress.test.jsx` legacy keys and snapshots | `collection-review.mjs` creates a workspace card, finds the same card in Vocabulary/CSV and practises both legacy directions; rehearsal fingerprints cover real legacy rows. |
| R8 | Same backend files as R1–R7; `test_generic_directions.py` and `test_csv_v2.py` name `en/da`, `en/el` and `el/it` cases explicitly | `SharedCollections.test.jsx`, `languages.test.js`, `grammar.test.js`, `PracticeCardView.generic.test.jsx` | `collection-csv-flow.mjs` (`en/da`, `en/el`), `collections.mjs` (generic pairs), `collection-review.mjs` (legacy `el/it`). Browser suites are local loopback checks, not hosted CI. |
| R9 | 423 backend tests passed, 3 opt-in tests skipped; Ruff and compileall clean on the rehearsal branch | 296 frontend tests passed in 26 files; ESLint and production build clean (existing bundle-size warning) | [Release readiness](v140-release-readiness.md) records documentation updates, the disposable rehearsal and the unchanged no-production/no-publication status. |

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

The full backend suite and frontend checks are recorded in [v1.4.0 release readiness](v140-release-readiness.md). The Collections browser suites require a loopback-only fixture and disposable database as described in [collection verification](shareable-collections-verification.md#reproduction); they are not part of the default `make check`.
