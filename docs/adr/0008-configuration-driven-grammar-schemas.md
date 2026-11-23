# Configuration-driven grammar schemas

Optional grammar is declared as data, validated from that data, and stored once per card in a structured JSON column. Italian and Greek keep every historical field, value and import/export representation; universal languages keep common fields only.

## Decision

- `backend/app/grammar_definitions.json` is the single source of truth. Each language declares its fields with a type, allowed options, maximum length, storage alias, applicable word types, conditional requirement and CSV key. The frontend imports the same file for its rendering helpers.
- `vocabulary_entries.grammar` is one nullable JSON column keyed by language ID. The additive migration backfills it from legacy columns; the legacy `italian_*`/`greek_*` columns stay as compatibility aliases and are refreshed on every create, update and import.
- Validation is definition-driven. Unknown languages, fields and forms, wrong value types, invalid options, overlong text and missing required genders produce actionable errors. CSV v2 row errors include the grammar field path; API errors include the same paths.
- Adding an enhanced language means adding one definition to the JSON data. No new column, migration, API branch or React component is required. Tests register a synthetic definition at runtime to prove this.
- The definition format is deliberately narrow (enum/text fields and conditional requirements), not a universal linguistic engine. CSV v2 cells use the same definitions and no longer derive `example` or `pronunciation` field names from legacy prefixes.

## Alternatives considered

- **Add one column per new language field.** This repeats the legacy drift problem and requires a migration for every language.
- **Keep a frontend-only definition list.** It silently diverged from backend validation and from CSV exchange.
- **Infer grammar from legacy key names.** The historical `italian`/`greek` names are data, not a convention; deriving fields caused missing-key failures for `example` and `pronunciation`.

## Consequences

Existing Italian/Greek behaviour, gender corrections, snapshots, progress and CSV round trips are unchanged because compatibility columns are still written and read. The structured column is authoritative for new enhanced languages whose fields have no historical column. `VocabularyOutput` exposes `grammar`, while practice snapshots deliberately keep their historical flat shape.
