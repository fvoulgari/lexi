# Shareable collections

Tracked in [issue #64](https://github.com/fvoulgari/lexi/issues/64). This feature is a separate branch and draft PR stacked on the unmerged authentication branch. It does not alter provider configuration, authentication credentials or the authentication release's staging/production environment.

## Model and permissions

- Reuse `collections`, `collection_entries` and `vocabulary_entries`: one card row, composite membership primary key, explicit position and deferred unique order. Same spelling never causes a merge.
- A collection pair is unordered/canonical; practice direction and card text order are separate. Supported identifiers: `el`, `it`, `en`, `da`. New collections require two different languages, start private and retain their pair.
- Each reference has `publication_confirmed`, initially false. Publication preview requires explicit confirmation for every private card owned by the collection creator, even if another of their collections already shares it. Adding a private owned card to an already published collection also confirms that card's current text. Stale preview/text fingerprints are rejected.
- Collection publication never changes a private card's stored visibility or ownership. Its grant is active only when the reference is confirmed, the collection is published, and the collection owner is the card creator. Another learner's private or published collection can reference an accessible card but cannot grant or extend access.
- Unpublishing clears that collection's confirmations. Deletion and reference removal delete the corresponding grant. If another valid creator-owned grant remains, access continues. Otherwise card reads, search, CSV, new queues and existing session/summary responses hide the text. References, reviews and difficulty remain. Republishing requires confirmation and restores access to the same card ID and learning state.
- Unpublish preview distinguishes cards losing their last grant from cards still shared elsewhere. Creators can review/reconfirm sharing for an already published collection or explicitly stop sharing a card through all their collections.
- Independently published library cards retain their original visibility and editor/admin policy. Collection grants never apply to private units or tags; those retain their own scopes. Creator-only editing of owned cards still uses the existing unit/tag ownership checks in Vocabulary; those checks are not relaxed.
- Queues deduplicate IDs across selected collections before selection/counting. Learning state remains `(profile_id, entry_id, direction)` and unique totals count card IDs once across directions. Collection progress reads that state without copying it.

## UI

Open Vocabulary → My collections → the collection workspace link. Choose a language pair, create a collection, create a card or search/add an accessible existing card, reorder references, preview publication, then confirm. Shared library lists published collections for the selected pair. Select one or several collections and a direction for normal or difficult-only practice. All new copy supports English, Greek and Italian; controls retain notebook typography, cream panels and sage accents.

Italian–Greek cards created in the workspace use Italian text in the Italian slot and Greek text in the Greek slot, so the existing Vocabulary editor, CSV export and both practice screens work for the same ID. Explicit language mapping also handles old reversed session snapshots without rewriting their history. Additional pairs use the generic workspace. The practice endpoint validates both pair and direction at creation, reveal and review.

## Migration and rollback

Migration `c57e88b0e010` follows `b46d77a9d009` and runs transactionally:

1. Inspect every existing collection's referenced cards, including archived/restricted cards. Reject mixed, unsupported or identical-language pairs with collection IDs before changing the schema. Resolve those IDs through reviewed classification; do not guess, discard references or publish content.
2. Backfill nonempty collections from their cards' explicit language IDs. Empty historical collections receive Greek–Italian because the preceding application supported only that pair. Existing cards, IDs, memberships, owners and audience are untouched.
3. Existing collections become explicitly private. Since no previous ordering existed, initialize positions deterministically by card ID. Add duplicate/order/pair constraints and a membership pair-check trigger.
4. Extend review direction validation while retaining old direction keys. The original draft permitted owned published cards; the follow-up below removes that accidental permanent exposure.

Follow-up migration `d68f99c1f011` is additive and follows the already committed draft migration. It adds per-reference confirmation flags (false by default) and a partial index for active grant lookup. It never infers consent from membership. In the pre-feature schema independently published library cards are unowned; they remain unchanged. Owned permanent publications introduced by the superseded draft are returned to private visibility, without deleting cards or references. Their creators must explicitly review sharing in each published collection before others regain access. If a database has out-of-band owned independent publications, classify those separately before applying this assumption; no such data is inferred or silently published.

The follow-up normalizes cards with explicit `el` → `it` storage to `it` → `el` by swapping only the two primary text slots in place. Language-named grammar attributes keep their meaning and values. Card IDs, owners, collections, review snapshots, review directions and progress rows remain intact. Historical reversed snapshots retain their original language identifiers and are mapped correctly by both renderers. No second card or progress key is created.

Before a real migration, rehearse against a protected backup and verify IDs, audience, memberships, histories and ambiguous-data report. No real/staging/production database was migrated for this PR. Capture a full pre-change backup plus deployment version and verify restore into a separate disposable database before a future cutover.

Rollback is restore-based, not automatic downgrade: stop writes, retain a post-cutover backup, restore the verified pre-change backup into a separate database, verify old schema/application together, then switch only after review. Do not silently drop post-cutover cards, references, publications or reviews; reconcile them through a reviewed procedure. An older application does not enforce collection-scoped publication grants, so merely switching the old image onto the new writable schema is not an approved rollback.

## Verification

Detailed execution evidence is in [collection verification](shareable-collections-verification.md). Browser fixtures replace only verified-provider identity, run on loopback against a disposable PostgreSQL database and are excluded from the production image. They do not establish managed-provider or hosted deployment acceptance.
