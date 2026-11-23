# Registry-backed language integrity

Store learning languages and practice directions as registry data with foreign keys from cards, Collections, practice sessions, reviews and progress. The supported catalogue can then grow by inserting rows, without per-language columns or a new DDL change for every language.

## Decision

- `languages` holds one row per learning language ID, with a display name.
- `practice_directions` holds each stored direction key together with its explicit prompt and answer language IDs.
- Card and Collection language columns reference `languages`; practice session, revealed-answer, review and progress direction columns reference `practice_directions`.
- The surviving check constraints enforce only structural rules: a card's two language IDs differ, a Collection pair is stored in canonical order, and direction prompt/answer languages differ.
- Existing Italian/Greek text slots, card IDs, Collection memberships, review keys, progress and permission values are not rewritten.
- Legacy direction keys (`greek_to_italian`, `italian_to_greek`) remain the stored keys; they are rows in `practice_directions`, not generated strings in a check constraint.

Adding a basic language is an insert into `languages` plus an insert for each direction into `practice_directions`. Removing a registry row still referenced by content is rejected by the database, so orphan references cannot be created.

## Alternatives considered

- **Keep enumerated check constraints.** This was the v1.4.0 design. It is safe but every new language needs a migration, which contradicts the language-agnostic goal.
- **Replace them with a generic identifier-format check.** This removes the migration but admits unknown IDs, silent practice failures and unreadable CSV; referential integrity is lost.
- **Rewrite review and progress direction keys into a new shape.** This would destroy existing learning history and is not acceptable for production data.

## Consequences

The application must insert registry rows before writing cards or Collections with a newly registered language; the seed path and migration do so. Public visibility of a language remains a separate, curated decision (later tickets); a registered row does not automatically make a language available in the UI. Downgrade of this migration is only safe while no registry-only languages or directions exist; otherwise it refuses rather than discarding data.
