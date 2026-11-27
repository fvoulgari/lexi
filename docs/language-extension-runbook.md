# Language-extension runbook

This runbook explains how to add a learning language after the language-agnostic architecture shipped in #115–#121. [Issue #143](https://github.com/fvoulgari/lexi/issues/143) expanded the catalogue to 35 publicly available languages: `ar`, `bn`, `bg`, `ca`, `cs`, `da`, `de`, `el`, `en`, `es`, `fa`, `fi`, `fr`, `he`, `hi`, `hu`, `id`, `it`, `ja`, `ko`, `nl`, `no`, `pl`, `pt`, `ro`, `ru`, `sk`, `sv`, `sw`, `th`, `tr`, `uk`, `ur`, `vi`, `zh`. `it`, `el` and `da` are enhanced; all others are basic. Basic languages are ordinary registry rows, not special cases.

The database registry is the single source of truth. A `languages` row is *backend-supported*; a row with `publicly_available = true` is also *curated* and appears in `/api/languages`, the searchable picker and Collections. The curated catalogue is therefore a deliberate subset of backend-supported rows. A hidden registry-only row can be used by backend validation and tests without being advertised to learners.

> **Basic language rule:** a basic language is a registry data change only — **no core logic, no per-language columns, no schema migrations, no React components, no CSS rules and no grammar definitions**. Existing deployments still need an idempotent **data-only** Alembic revision to insert the registry rows; it must not change schema, add columns or rewrite learner data. The #143 expansion was the one-time exception that added `languages.native_name` and `languages.aliases` so the shared pickers could search native names and accents; those columns are language metadata, not vocabulary columns.

An enhanced language adds exactly one configuration file entry in `backend/app/grammar_definitions.json`. It still adds no columns, components, CSS or core-language branches. Danish is the structured-only example: `common`/`neuter`, plural, example and pronunciation live in the existing `grammar` JSON without Italian/Greek compatibility columns.

## 1. Decide the kind of change

| Decision | Basic language | Enhanced language |
| --- | --- | --- |
| Registry row | Required | Required |
| `publicly_available` flag | Required for public curation | Required for public curation |
| Ordered `practice_directions` rows | Required for both directions of every pair | Required |
| Grammar definition file entry | **No** | Required |
| New database column/table | **No** | **No** |
| Core endpoint/frontend component edit | **No** | **No** |
| Schema migration | **No** | **No** |
| Data-only Alembic revision for existing deployments | Required | Required |

Do not add a language-specific `if`, column, component, route, stylesheet rule or CSV field. If a proposed change needs one of those, it is not following this architecture.

## 2. Data/configuration touchpoints

### Files to change

| Touchpoint | File | Basic-language change | Enhanced-language change |
| --- | --- | --- | --- |
| Bootstrap catalogue | `backend/app/language_catalogue.json` | Add the `id`, `label`, `native_name`, `aliases`, `script`, `text_direction`, `enhanced: false` and `publicly_available` row. Keep the two legacy direction keys in `legacy_directions`. | Same row with `enhanced: true`; the definition must exist before release. |
| Existing-database registration | New data-only revision in `backend/alembic/versions/`, modelled on `a1b2c3d4e5f6_universal_languages.py` or `c4d5e6f70819_expanded_language_catalogue.py` | Idempotently insert/update the `languages` row and insert every ordered `practice_directions` row. Do not alter schema or rewrite learner data. Guard downgrade if cards or collections reference the language. | Same registration; no schema work. |
| Enhanced grammar definition | `backend/app/grammar_definitions.json` | **Do not edit.** Basic languages intentionally have no definition and reject submitted grammar. | Add the language-keyed definition using existing field types, storage names and CSV keys. Do not add a column. |
| Targeted tests | `backend/tests/test_language_catalogue.py`, `test_language_registry_integrity.py`, `test_universal_languages.py`, `test_common_card_fields.py`, `test_generic_directions.py`, `test_csv_v2.py`; `frontend/src/LanguagePicker.test.jsx`, `universal-languages.test.jsx`, `languages.test.js` | Extend existing registry/CSV/direction tests; a synthetic hidden registry row is useful for proving no code change is needed. | Add definition-driven field tests, including rejection of grammar on basic cards. |
| Frontend test fixture | `frontend/src/language-fixtures.js` | Extend the fixture or the test-specific payload when default unit tests should see the new public row. The fixture is test data, not a production language list. | Same, plus definition-driven rendering expectations. |
| Documentation | `README.md`, `GLOSSARY.md`, `docs/spec.md`, `docs/multilingual-acceptance.md`, `docs/csv-format.md`, `docs/shareable-collections.md`, relevant ADRs, this runbook and [final verification](language-architecture-verification.md) | Update the curated list and basic/enhanced classification. Keep interface-language and release-status wording accurate. | Update grammar wording and CSV examples. |

### Files driven by data — verify, do not edit

| Touchpoint | File | Why no edit is needed |
| --- | --- | --- |
| Bootstrap constants and legacy keys | `backend/app/languages.py` | `LANGUAGES`, `LANGUAGE_LABELS`, `LANGUAGE_METADATA`, `LEGACY_DIRECTIONS` and `DIRECTION_PAIRS` are derived from the catalogue. Legacy keys are historical IDs, not a pattern for new languages. |
| Fresh-install seed | `backend/app/seed.py` | Seeds `languages` and `practice_directions` from those derived constants with `ON CONFLICT DO NOTHING`. |
| Runtime validation | `backend/app/registry.py`, `backend/app/models.py` | The registry is refreshed from the database per request; pair and direction validation reads those rows. Structural constraints only require two different IDs and a canonical pair. |
| Public catalogue API | `backend/app/languages_api.py` | `/api/languages` publishes only public languages and directions whose endpoints are both public. |
| Card text and grammar storage | `backend/app/models.py`, `backend/app/schemas.py`, `backend/app/grammar.py` | One nullable structured grammar column plus compatibility text slots serve every language. Definitions are keyed by language ID. |
| CSV v2/v3/simple | `backend/app/csv_v2.py`, `backend/app/csv_export.py`, `backend/app/csv_format.py`, `backend/app/imports.py` | `text_<lang>` and `grammar_<lang>` headers come from the registry and are scoped to the destination pair. Historical registry-wide v2 files still import by language ID. Basic grammar cells stay empty; v3 adds `schema_version`/`metadata` and simple maps Base/Learning onto the chosen pair. Frozen `COLUMNS` constants are fixtures only; runtime uses the registry helpers. |
| Frontend bootstrap | `frontend/src/main.jsx`, `frontend/src/languages.js`, `frontend/src/LanguagePicker.jsx` | The app hydrates from `/api/languages`; labels, native names, aliases, directions, `lang`, `dir` and script metadata come from that response. Base and Learning use the same searchable combobox with popular/recent choices and accent-tolerant matching; there is no production language array or generated all-pairs dropdown. |
| Grammar rendering | `frontend/src/grammar.js`, `frontend/src/CardFields.jsx`, `frontend/src/VocabularyForm.jsx`, `frontend/src/CollectionCardForm.jsx`, `frontend/src/PracticeCardView.jsx` | Shared components render fields described by the imported grammar definitions. A basic language needs no new component. |
| Text direction and script styling | `frontend/src/styles.css` | Styling keys off generic `dir` and `data-script` attributes; no per-language CSS branch is added for Arabic, Japanese or any later basic language. |
| Interface copy | `frontend/src/copy.js`, `frontend/src/account-copy.js`, `frontend/src/collection-copy.js` | These files localize the interface in `en`/`el`/`it`; they are independent of learning-language IDs. |

## 3. Registration procedure

1. **Choose the ID and metadata.** Use a stable lowercase registry ID. Record `label`, `script`, `text_direction`, `enhanced` and whether the row is curated. Set `publicly_available` deliberately; backend support alone never advertises a language.
2. **Update the bootstrap catalogue.** Add the row to `language_catalogue.json`. For a basic language, leave `enhanced` false. For an enhanced language, add the matching definition first or in the same change.
3. **Write one data-only Alembic revision.** Copy the shape of `a1b2c3d4e5f6_universal_languages.py`: upsert the `languages` row, insert both directions for every pair with existing registered languages, and use `ON CONFLICT DO NOTHING`. Do not create columns, constraints, indexes, triggers or backfills. Keep `greek_to_italian` and `italian_to_greek` legacy; all new keys are ordinary directions. The 35-language catalogue has 1190 explicit ordered direction rows; `c4d5e6f70819` adds only rows for newly curated languages and must never rewrite or renumber existing IDs.
4. **Check the downgrade path.** The revision must refuse to delete a language still referenced by cards or collections, as the `ja`/`ar` and `c4d5e6f70819` revisions do. `c4d5e6f70819` also removes only its own newly added direction IDs; legacy direction IDs are never deleted or rewritten. Never silently remove learner data.
5. **Verify a fresh install and a migration.** A fresh seeded database and a restored baseline upgraded to head must both expose the same public catalogue and directions. Compare legacy rows with [the rehearsal helper](../scripts/migration-rehearsal.py) or an equivalent baseline-scoped manifest.
6. **Run targeted tests, then the full suites.** Add tests naming the new code and a hidden registry-only row; then follow the commands in [final verification](language-architecture-verification.md).
7. **Reconcile docs and stop at the handoff.** Update the curated list, classification and evidence links. Do not migrate production, deploy, tag or publish a release as part of a language extension.

## 4. Preserved behavior that must not be reintroduced as special cases

- **Enhanced grammar.** `it` and `el` definitions, legacy field names, values and CSV keys remain authoritative. `da` adds structured-only `common`/`neuter`, plural, example and pronunciation without new columns. A new basic language must not modify any definition; a new enhanced language is another keyed definition. Grammar is validated only for the languages on the card, and basic cards reject submitted grammar.
- **Permissions and visibility.** Publication grants depend on card ownership, collection publication and explicit confirmation — never on language ID. A reader's saved collections and access checks are unchanged by adding a language.
- **Collection pair rules.** A populated collection keeps its pair; an empty collection may change it. A card's language IDs are immutable, and reversed pair order remains compatible because text is mapped by ID.
- **CSV compatibility.** Collection exports use registry-derived v2 columns scoped to the pair, with opt-in v3 for lossless structured grammar and a simple Base/Learning template. The aggregate library export remains v1 unless explicitly requested. Historical registry-wide v2 files still import; v1 and unversioned files continue to mean Italian–Greek. New language IDs never change v1 matching or column order semantics.
- **Base/Learning orientation.** Orientation is a UI/destination choice, not a mutation of the unordered collection pair. Switching it must not change card IDs, texts, progress, permissions or shared/public collections; a public collection remains usable in either orientation.
- **Review progress.** Progress is keyed by learner, card and practice direction. Both directions of a new pair use the existing session/review endpoints and progress table; no language-specific progress key is introduced.

## 5. Verification checklist

- [ ] `GET /api/languages` contains exactly the intended public rows (35 in #143) and every ordered public direction (1190); hidden registry rows and rewritten legacy direction IDs are absent.
- [ ] A card can be created in the Collections workspace for every ordered public pair, with texts supplied by the user.
- [ ] Both directions round-trip through preview, reveal and review without mixing text or progress.
- [ ] Basic cards expose only common fields; any submitted grammar for them is rejected. Danish offers `common`/`neuter` as structured-only fields and v3 preserves them without new columns.
- [ ] Italian/Greek grammar still round-trips through Vocabulary, CSV and both legacy practice screens; `common` remains an unresolved alias there.
- [ ] Base and Learning pickers are searchable by English/native name and aliases, work at 320/390/760 px, and switching orientation does not alter cards, progress or collection permissions.
- [ ] Publication preview, confirmation, saved collections and grant withdrawal still work at desktop and mobile widths.
- [ ] Scoped v2 and historical registry-wide v2 round-trip stable IDs, Unicode and formula escaping; v3 preserves structured grammar, simple maps Base/Learning, and v1 import regressions pass.
- [ ] Restored-baseline migration leaves every legacy row count and digest unchanged, with only `alembic_version` advancing.
- [ ] Backend, frontend, lint/build and browser suites are green; results are recorded in [final verification](language-architecture-verification.md).

## 6. Related records

- [Multilingual acceptance matrix](multilingual-acceptance.md)
- [Final language-architecture verification](language-architecture-verification.md)
- [ADR 0005: language-agnostic card text and grammar](adr/0005-language-agnostic-card-text-and-grammar.md)
- [ADR 0006: registry-backed language integrity](adr/0006-registry-backed-language-integrity.md)
- [ADR 0007: curated language catalogue](adr/0007-curated-language-catalogue.md)
- [ADR 0008: configuration-driven grammar schemas](adr/0008-configuration-driven-grammar-schemas.md)
- [CSV format](csv-format.md)
- [Shareable Collections](shareable-collections.md)
