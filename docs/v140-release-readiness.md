# v1.4.0 release readiness — 23 November 2026

This page records the specification, acceptance and rehearsal evidence for the multilingual language-pair initiative ([issue #100](https://github.com/fvoulgari/lexi/issues/100), final child [issue #107](https://github.com/fvoulgari/lexi/issues/107)). **No production database was migrated, no application was deployed, and no v1.4.0 release was published.** The checks below were run on local disposable resources only.

## Release content

v1.4.0 is a backward-compatible feature release after v1.3.2. “CSV v2” names the **file format** introduced for Collections; v1 CSV files remain importable and the release version is independent of that number. Vocabulary card creation stays Italian–Greek; the Collections workspace supports any ordered pair from the `da`, `el`, `en`, `it` registry. See the [acceptance matrix](multilingual-acceptance.md) for the rule-to-test mapping.

Additive schema changes in this initiative:

| Revision | Change | Downgrade |
| --- | --- | --- |
| `f7a12b4c0001` | `vocabulary_card_languages` check constraint; aborts on unsupported existing IDs instead of rewriting them | Drops the constraint |
| `b7c41d0e9a32` | `collection_pair_population` trigger; blocks changing a Collection pair while it has cards | Drops the trigger and function |

No new language text columns, card rewrites, ID changes or progress-key changes are introduced. API changes are likewise additive: pair and direction validation derives from one registry, a populated Collection rejects a pair change while an empty one accepts it, card language IDs are immutable after creation, grammar follows those IDs, and Collection CSV export defaults to v2 with an explicit `format=v1` option. The aggregate library export remains v1.

ADR numbering note: ADR 0004 was allocated to the language-keyed CSV v2 format by #105. The language-agnostic card text and grammar decision is therefore [ADR 0005](adr/0005-language-agnostic-card-text-and-grammar.md), extending [ADR 0003](adr/0003-creator-owned-published-collections.md) without superseding it.

## Disposable backup/restore and migration rehearsal

Source: the owner-only, locally retained frozen v1.3.0 production backup at pre-v1.4.0 revision `a47c39f0a019`, SHA-256 `30b050a5fe8ae2ac701309147235d00c7d151ea76e11b296183e27ca3a8ffc65` (matches the protected retention record). It was restored only into a newly created PostgreSQL 18.6 container bound to `127.0.0.1:55436`, with separate `lexi_v140_pre`, `lexi_v140_restored`, `lexi_v140_newpair_test` and `lexi_v140_full_test` databases. No hosted or shared database was contacted.

| Step | Result |
| --- | --- |
| Verify backup checksum | PASS; matches the recorded frozen-backup digest |
| `pg_restore --exit-on-error --no-owner --no-privileges` into `lexi_v140_pre` | PASS; revision `a47c39f0a019`, 264 Italian→Greek cards, 5 Greek→Italian Collections, 50 reviews in 2 legacy directions |
| Deterministic row manifest of the restored baseline | Captured: counts and ordered-row digests for all 16 application tables |
| Fresh custom-format dump of the restored baseline, then restore into `lexi_v140_restored` | PASS; both manifests matched exactly before migration |
| `alembic upgrade head` on both databases | PASS; both reached `b7c41d0e9a32` with no data rewrite |
| Compare all row manifests before/after migration, and migrated/re-restored databases | PASS; all 16 table digests and counts identical; only `alembic_version` changed |
| Database guard and new-pair checks on the migrated legacy database | PASS: wrong-pair membership rejected, unsupported card language rejected, populated Collection pair change rejected, new `en/da` Collection and card accepted (transaction rolled back) |
| Targeted new-pair HTTP tests against a separate disposable `_test` database | 86 passed: registry, card mapping, Collection pair rules, generic directions, common/grammar fields, CSV v2 and the card-language migration guard |
| Full backend suite on a separate disposable `_test` database | 423 passed, 3 opt-in tests skipped; one pre-existing Starlette/httpx deprecation warning |
| Backend Ruff and compileall | PASS |
| Frontend ESLint, Vitest and production build | PASS: 296 tests in 26 files; existing >500 kB chunk warning only |

Legacy row digests (MD5 of ordered rows, JSON-normalized; identical before and after migration and across the second restore):

| Table | Rows | Digest |
| --- | ---: | --- |
| `vocabulary_entries` | 264 | `2ac986cc0b6d28d31d173560e4fd7c19` |
| `collections` | 5 | `f19653224c1a40640cf26256b4cf15bf` |
| `collection_entries` | 264 | `cadd9b3782c83547c10eebc49ce27ea0` |
| `review_events` | 50 | `410bd138114a86104637cc7bd24ff513` |
| `practice_sessions` | 22 | `8c34e1fc1a405b785f44c9394e869d45` |
| `session_cards` | 396 | `02b7647602a75fad67909c2bfcec7315` |
| `learning_progress` | 39 | `7af90fc81c6b9b2c9256e59b113fb8a5` |
| `entry_tags` | 245 | `328e1413d7e3f61644b29dda240c20f6` |
| `profiles` | 10 | `d1319d816a57cc27578b9a1ea7404103` |
| `accounts` | 4 | `07a56a610ac4352ed96afa048fbaddfb` |

The same unchanged-digest result also covers `account_deletions`, `account_directory`, `login_throttles`, `recovery_case_guards`, `security_events` and `tags` (all 16 manifests were compared in full during the rehearsal). Stable card IDs, text slots, Collection memberships, review and session wording snapshots, direction keys and progress rows were all preserved. Historical reversed snapshots remain interpretable through their own language IDs; see [the acceptance matrix](multilingual-acceptance.md#test-mapping) for the targeted tests.

This is a local logical backup/restore rehearsal. It does not establish managed-provider snapshot restoration, hosted CI success or production acceptance. The temporary container and its databases were removed after the evidence was captured; no dump or credential was added to Git.

## Release checklist

- [x] Specification status, [ADR 0005](adr/0005-language-agnostic-card-text-and-grammar.md), [glossary](../GLOSSARY.md), [README](../README.md), [CSV format](csv-format.md) and [Collections guide](shareable-collections.md) match the confirmed rules.
- [x] [Acceptance matrix](multilingual-acceptance.md) maps every rule to backend, frontend or browser evidence, including `en↔da`, `en↔el` and legacy `el↔it`.
- [x] Disposable backup/restore and migration rehearsal above records unchanged legacy IDs, content, memberships, reviews, sessions and progress plus successful new-pair flows.
- [x] Draft PR for #107 links the child issues and states that no production migration, deployment or release publication is included.
- [x] Release materials name v1.4.0 and explain that CSV v2 is a file-format version.
- [ ] Operator: confirm hosted checks pass on the draft PR before any release action.
- [ ] Operator: taking a new protected backup and verifying its checksum remains mandatory immediately before any future cutover; this rehearsal used a frozen historical backup.
- [ ] Operator: repeat restore and migration verification in the isolated provider environment, then run the migration with the schema-owner credential and the application smoke checks.
- [ ] Operator: tag and publish v1.4.0 only after explicit release authorisation. Authentication cleanup and deprecated-issue closure remain a separate initiative.

Rollback remains restore-based, not an automatic downgrade of the full history: stop writes, keep a post-cutover backup, restore the verified pre-cutover backup into a separate database and review before switching. Do not silently discard post-cutover cards, references, publications or reviews.
