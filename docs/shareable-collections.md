# Shareable collections

Tracked in [issue #64](https://github.com/fvoulgari/lexi/issues/64). This feature is a separate branch and draft PR stacked on the unmerged authentication branch. It does not alter provider configuration, authentication credentials or the authentication release's staging/production environment.

## Model and permissions

- Reuse `collections`, `collection_entries` and `vocabulary_entries`: one card row, composite membership primary key, explicit position and deferred unique order. Same spelling never causes a merge.
- Collection pair is unordered/canonical; card source/target order is retained. Supported identifiers: `el`, `it`, `en`, `da`. New collections require two distinct supported languages and start private. Pair is immutable after creation.
- Card text uses source/target aliases over the original two storage columns. No duplicate text columns or additional language-specific columns. Historical snapshots, Italian–Greek directions and progress keys are preserved.
- A creator controls collection title, references, order and publication. A card creator alone controls their owned card text/publication. Existing unowned legacy/shared cards retain their original editor/admin authorization.
- Publication preview contains title, pair, accessible count and every private card exposed. POST requires the exact private IDs and unchanged preview fingerprint. Concurrent text/membership/title changes require review again. Adding a private card to a published collection also confirms its current text fingerprint. Creating a new card in a published collection requires an explicit exposure checkbox.
- Promoted cards retain their owner and become readable directly and through other collections. Unpublishing a collection hides only that collection; explicitly published cards remain public until their creator withdraws them. This consequence is shown before publication.
- Every view/search/practice queue uses the existing card audience and archival scope. Missing, private foreign, withdrawn and archived cards are not exposed by a reference. Owners can remove unavailable references without receiving hidden card text. Publication fails closed if a reference is unavailable or restricted.
- Queues use `IN` membership over all selected collections, deduplicating card IDs before queue counts/selection. Existing learning state remains `(profile_id, entry_id, direction)`. Collection progress reads that state rather than creating a collection-specific copy. Overall review totals count distinct card IDs across directions.

## UI

Open Vocabulary → My collections → the collection workspace link. Choose a language pair, create a collection, create a card or search/add an accessible existing card, reorder references, preview publication, then confirm. Shared library lists published collections for the selected pair. Select one or several collections and a direction for normal or difficult-only practice. All new copy supports English, Greek and Italian; controls retain notebook typography, cream panels and sage accents.

The original vocabulary grammar/CSV screens remain Italian–Greek-only to avoid labelling another language as Italian or Greek. Additional pairs use the collection workspace's generic card form and practice view. The practice endpoint continues validating both pair and direction at creation, reveal and review.

## Migration and rollback

Migration `c57e88b0e010` follows `b46d77a9d009` and runs transactionally:

1. Inspect every existing collection's referenced cards, including archived/restricted cards. Reject mixed, unsupported or identical-language pairs with collection IDs before changing the schema. Resolve those IDs through reviewed classification; do not guess, discard references or publish content.
2. Backfill nonempty collections from their cards' explicit language IDs. Empty historical collections receive Greek–Italian because the preceding application supported only that pair. Existing cards, IDs, memberships, owners and audience are untouched.
3. Existing collections become explicitly private. Since no previous ordering existed, initialize positions deterministically by card ID. Add duplicate/order/pair constraints and a membership pair-check trigger.
4. Permit creator-owned published cards without dropping ownership. Extend review direction validation while retaining the old direction keys. Do not rewrite reviews, snapshots or learning progress.

Before a real migration, rehearse against a protected backup and verify IDs, audience, memberships, histories and ambiguous-data report. No real/staging/production database was migrated for this PR. Capture a full pre-change backup plus deployment version and verify restore into a separate disposable database before a future cutover.

Rollback is restore-based, not automatic downgrade: stop writes, retain a post-cutover backup, restore the verified pre-change backup into a separate database, verify old schema/application together, then switch only after review. Do not silently drop post-cutover cards, references, publications or reviews; reconcile them through a reviewed procedure. An older application does not understand creator-owned publication semantics, so merely switching the old image onto the new writable schema is not an approved rollback.

## Verification

Detailed execution evidence is in [collection verification](shareable-collections-verification.md). Browser fixtures replace only verified-provider identity, run on loopback against a disposable PostgreSQL database and are excluded from the production image. They do not establish managed-provider or hosted deployment acceptance.
