# Shareable collections

Collections organise reusable cards for browsing and practice.

## Model and permissions

- Reuse `collections`, `collection_entries` and `vocabulary_entries`: one card row, composite membership primary key, explicit position and deferred unique order. Same spelling never causes a merge.
- A collection pair is unordered/canonical; practice direction and card text order are separate. Supported identifiers come from the curated `/api/languages` catalogue (`ar`, `da`, `el`, `en`, `it`, `ja` in the shipped configuration). New collections require two different languages, default to private and retain their pair. The Vocabulary management form can explicitly create an empty Public collection.
- Each reference has `publication_confirmed`, initially false. Publication preview requires explicit confirmation for every private card owned by the collection creator, even if another of their collections already shares it. Adding a private owned card to an already published collection also confirms that card's current text. Stale preview/text fingerprints are rejected.
- Collection publication never changes a private card's stored visibility or ownership. Its grant is active only when the reference is confirmed, the collection is published, and the collection owner is the card creator. Another learner's private or published collection can reference an accessible card but cannot grant or extend access.
- Unpublishing clears that collection's confirmations. Deletion and reference removal delete the corresponding grant. If another valid creator-owned grant remains, access continues. Otherwise card reads, search, CSV, new queues and existing session/summary responses hide the text. References, reviews and difficulty remain. Republishing requires confirmation and restores access to the same card ID and learning state.
- Unpublish preview distinguishes cards losing their last grant from cards still shared elsewhere. Creators can review/reconfirm sharing for an already published collection or explicitly stop sharing a card through all their collections.
- Independently published library cards retain their original visibility and editor/admin policy. Collection grants never extend to another learner's private cards or learning records, and creator-only editing of owned cards uses the unchanged Vocabulary ownership checks. Tags are shared labels, not an access boundary; former Unit metadata is retained only for legacy import compatibility.
- Queues deduplicate IDs across selected collections before selection/counting. Learning state remains `(profile_id, entry_id, direction)` and unique totals count card IDs once across directions. Collection progress reads that state without copying it.

## UI

In Vocabulary, open **My collections** to select an owned Italian–Greek collection, see its card count and visibility, or create one. **Edit collection** changes the name or visibility; changing an existing collection to Public opens the card-sharing preview for confirmation. Deleting a collection removes its references and grants while preserving the cards and learning history.

Open the **Collections** workspace for all curated language pairs and shared collections. Choose any two different languages in the registry-backed, searchable picker (`ar`, `da`, `el`, `en`, `it`, `ja` in the shipped configuration), create a collection, create a card or search/add an accessible existing card, reorder references, preview publication, then confirm. A collection's pair is fixed once it has cards; an empty collection may change pair, and a card's own language IDs never change. Reversed pair order is compatible: the same card can join several compatible collections without duplication, and texts follow language IDs rather than position. Shared library lists published collections for the selected pair. Select one or several collections and either direction for normal or difficult-only practice; progress remains per learner, card and direction. All new copy supports English, Greek and Italian; controls retain notebook typography, cream panels and sage accents. See the [multilingual acceptance matrix](multilingual-acceptance.md) and [final language-architecture verification](language-architecture-verification.md).

Italian–Greek cards created in the workspace use Italian text in the Italian slot and Greek text in the Greek slot, so the existing Vocabulary editor, CSV export and both practice screens work for the same ID. Explicit language mapping also handles old reversed session snapshots without rewriting their history. Curated pairs use the same registry-backed card form; no per-pair component or column is added. The practice endpoint validates both pair and direction at creation, reveal and review.

## Historical migration and rollback record

Migration `c57e88b0e010` follows `b46d77a9d009` and runs transactionally:

1. Inspect every existing collection's referenced cards, including archived/restricted cards. Reject mixed, unsupported or identical-language pairs with collection IDs before changing the schema. Resolve those IDs through reviewed classification; do not guess, discard references or publish content.
2. Backfill nonempty collections from their cards' explicit language IDs. Empty historical collections receive Greek–Italian because the preceding application supported only that pair. Existing cards, IDs, memberships, owners and audience are untouched.
3. Existing collections become explicitly private. Since no previous ordering existed, initialize positions deterministically by card ID. Add duplicate/order/pair constraints and a membership pair-check trigger.
4. Extend review direction validation while retaining old direction keys. The original draft permitted owned published cards; the follow-up below removes that accidental permanent exposure.

Follow-up migration `d68f99c1f011` is additive and follows the already committed draft migration. It adds per-reference confirmation flags (false by default) and a partial index for active grant lookup. It never infers consent from membership. In the pre-feature schema independently published library cards are unowned; they remain unchanged. Owned permanent publications introduced by the superseded draft are returned to private visibility, without deleting cards or references. Their creators must explicitly review sharing in each published collection before others regain access. If a database has out-of-band owned independent publications, classify those separately before applying this assumption; no such data is inferred or silently published.

The follow-up normalizes cards with explicit `el` → `it` storage to `it` → `el` by swapping only the two primary text slots in place. Language-named grammar attributes keep their meaning and values. Card IDs, owners, collections, review snapshots, review directions and progress rows remain intact. Historical reversed snapshots retain their original language identifiers and are mapped correctly by both renderers. No second card or progress key is created.

Before a real migration, rehearse against a protected backup and verify IDs, audience, memberships, histories and ambiguous-data report. No real/staging/production database was migrated for this feature work. Capture a full pre-change backup plus deployment version and verify restore into a separate disposable database before a future cutover. The latest restored-baseline rehearsal and its unchanged legacy row manifest are in [final language-architecture verification](language-architecture-verification.md); the earlier v1.4.0 record remains in [v1.4.0 work: readiness and local rehearsal](v140-release-readiness.md).

Rollback is restore-based, not automatic downgrade: stop writes, retain a post-cutover backup, restore the verified pre-change backup into a separate database, verify old schema/application together, then switch only after review. Do not silently drop post-cutover cards, references, publications or reviews; reconcile them through a reviewed procedure. An older application does not enforce collection-scoped publication grants, so merely switching the old image onto the new writable schema is not an approved rollback.

## Verification

Detailed execution evidence is in [collection verification](shareable-collections-verification.md). Browser fixtures replace only verified-provider identity, run on loopback against a disposable PostgreSQL database and are excluded from the production image. They do not establish managed-provider or hosted deployment acceptance.

## Card creation and collection visibility controls

The Vocabulary card form has no Audience control. New cards start owned/private;
users may choose an owned Italian–Greek collection when saving, with membership
created atomically. Other language-pair creation remains in the collection
workspace. The API rejects foreign-owner and incompatible collections. A public
collection requires explicit confirmation of this new card's exposure. An
ordinary card edit does not change ownership, stored visibility or progress.

Create collection and Edit collection expose Private/Public switches (stored
`private`/`published`). Private is the create default. Selecting Public on create
first saves a private collection, then opens the publication preview; explicit
confirmation is still required. Cancel leaves it private. Only its owner may
change visibility. Switching to Private reviews and withdraws that collection's
grant; another valid public collection owned by the card creator can retain access.
All cards, stable references and personal learning state remain preserved.
