# Legacy transition: audit and release gates

Status: **incomplete; not ready to merge or deploy**. This document records
the investigation, not approval to change production.

## Observed on 20 November 2026

- Railway production service `lexi` deployment
  `1fef76d7-6b52-4bce-89b7-a9bf29dcf3b9` is SUCCESS, using image digest
  `sha256:66b6de9af1ddbe3339e2f1f0c67fffcb8de5887a8cd5e07b341c072b58e60e73`.
  The existing production release report identifies that image as v1.2.1.
- Production PostgreSQL is the `Postgres` service in the `lexi` project.
  After the SSH host-key verification failure, read-only queries were run through
  the authenticated Railway database browser. No production application data was
  changed. A temporary SSH key from the earlier attempt was removed.
- Draft PR #65 is unmerged and contains a separate collection access design. Its
  schema and behavior must not be assumed to exist in production.
- The Admin screen controls account roles and legacy-library access as well as
  claims. Removing it without a deliberate replacement would remove active
  operator capabilities. Backend authorization and existing roles must remain.
- `accounts.profile_id` references `profiles.id` and is unique; the requested
  directory joins on this relationship. The migration owner, database roles and
  privileges must be inspected before designing an operator-only view. Revoking
  `PUBLIC` alone cannot restrict access if the application connects as its owner
  or another privileged role.


## Production audit and restore evidence

- Three accounts are linked to legacy profiles: Fofo is admin; Lollo and Spyros
  are learners. All three currently have legacy access. The verified IDs are
  held in the operator audit, not inferred from names or copied into migration
  code. Three generated links and three redeemed-claim security events exist.
- No collections or collection memberships exist. The four named groups are
  unowned legacy Units. Lollo sees them through the legacy-access flag, not
  collection ownership or publication. The 00, 30 and 50 Units contain 245, 8
  and 9 unowned legacy cards, respectively; 610 has no cards. This is a snapshot,
  not permission to overwrite later ownership changes.
- Six profiles lack an account: one legacy profile (Elias) and five non-legacy
  profiles, including Fofo and Spyros. All six have zero reviews, sessions and
  progress rows at audit time. One Lollo recovery request remains pending; no
  pending resolution case or unexpired active claim/continuation was found.
  Preserve every profile and the request; review the exception separately.
- On 20 November, `pg_dump -Fc` produced a protected archive on the existing
  PostgreSQL volume (SHA-256 `7a480103c6db67290dde7aeda0b0acd696eb31430089f43e261341a13907990e`).
  `pg_restore --no-owner --exit-on-error` succeeded into a new database on the
  same server at revision `b46d77a9d009`. Public CONNECT on the copy was revoked.
  Separate repeatable-read snapshots of the live and restored databases compared
  sorted complete-row JSON hashes and counts for all 20 public tables; both
  manifests matched (SHA-256
  `04bca7600fd361131e5eed28ca124002aec0bf89ecd8d5ea7a6322985713066d`).
  This comparison was taken after the backup without a write freeze; it establishes
  matching rows at those observations, not a final cutover baseline. It does not
  verify database grants, non-public schemas, migration behavior or recovery from
  loss of the shared server/volume. The restored database is not the live database.
- Railway's dashboard query runs as `postgres`, and live connections were also
  observed as `postgres`. The application role must be established definitively
  before promising that a view is operator-only: a superuser cannot be denied
  access to a view by ordinary grants.

## Corrected collection visibility decision

All four migrated collections begin **private**: 00 belongs to Fofo, while
30, 50 and 610 belong to Lollo. Their owners may later publish or withdraw a
collection through Edit collection, with the existing explicit confirmation
for owned private cards. No collection is automatically published.

This replaces the prior requirement to preserve cross-owner legacy access:
Fofo loses access to 30 and 50, while Lollo and Spyros lose access to 00.
Spyros also loses access to 30 and 50. Unit 610 currently contains no cards.
The owners retain access to their own cards. This statement describes current
legacy-card access; audit again at cutover for any intervening changes or other
independent grants. All users retain their profile IDs, reviews, progress,
sessions, card references and historical snapshots. Publication must restore
the original learner's existing progress, not create a replacement record.

The draft sharing branch has owner-controlled private/public collections and
regression coverage for withdrawal and republication. Its migration changes
must be reviewed against this production backup, including language text
normalization and metadata visibility, before the transition can be rehearsed
or deployed.

## Required before implementation and approval

1. Review the pending request and unlinked profiles without deleting or merging
   them. Never infer identity from a name. Map 00 and its cards to Fofo and 30,
   50 and 610 and their cards to Lollo, stopping on ownership conflicts.
2. Complete schema and privilege verification of the restored copy. Keep
   personal data and credentials out of the repository and PR. The same-service
   backup is not an independent recovery copy.
3. Rehearse a transactional, rerunnable plan on the restored copy. Compare IDs,
   card contents, memberships, ownership, audiences, profiles, reviews, sessions,
   snapshots and learning progress, including intended differences. Stop on
   ownership conflicts or unexpected changes; retain all learning records. The
   approved access change below is intentional and must be verified explicitly.
4. Prepare and test the claim retirement, account directory, collection
   unification and an operator path for active controls. Validate all three
   learners' access and personal progress and negative authorization cases.
5. Present sanitized dry-run and restoration evidence for review. No production
   mutation or deployment is authorized until the reviewed plan is approved.
   Coordinate a final write freeze and backup immediately before an approved
   cutover, accounting for concurrent writes as described in the authentication
   migration runbook.

## Comparison tooling

`python -m app.preservation_manifest capture PATH` captures the public schema's
primary keys and per-column hashes under one PostgreSQL repeatable-read,
read-only transaction, using `DATABASE_URL`. It fails if a table lacks a primary
key, rather than silently excluding it. Output is created exclusively with mode
0600 and must remain in protected storage. `python -m app.preservation_manifest
compare BEFORE AFTER` reports table, key and column changes and exits nonzero
when there are differences. Review expected changes individually; hashes do not
prove authorization behavior or replace an encrypted backup, restore, and
access tests. Record schema grants and non-public schemas separately. Do not
compare a live source to a later restore without accounting for concurrent writes.

## Implementation progress

The draft disconnects the legacy claim and recovery router. Its follow-up schema
revision revokes unfinished claim links and expires continuations while retaining
completed links, account associations and audit records. The Admin page retains
role assignment but no longer exposes claim management. The old claim URL shows
an unavailable message and a sign-in route. Targeted PostgreSQL and frontend tests
cover these changes; this is not a complete transition or deployment approval.

Read-only inspection of the restored copy found all 262 cards use Italian-to-Greek
language identifiers. Benvenuti has four distinct tags and 245 tag links; the
other named Units have none. The ownership migration must preserve those links,
make metadata available to its owner, and ensure publication does not expose
unrelated private metadata. No ownership conversion has been run yet.

## Ownership migration and separate role preparation

The draft adds `python -m app.legacy_collection_migration MAPPING --report FILE`.
It defaults to rollback, requires verified account, profile, Unit and complete card-ID
sets in the protected mapping file, and writes a new mode-0600 row/column comparison
report. `--apply` commits and must be used only for an approved cutover or the
separate rehearsal copy. The command serializes writers, reuses a uniquely matching
private collection, and fails on changed IDs, ambiguous collections, conflicting
ownership, incompatible languages, or a tag referenced by another Unit. The latter
is deliberately a stop for review; it does not transfer or duplicate shared tags.
The protected report and mapping contain learner identifiers and must not be posted.

The production-copy migration rehearsal, access validation and legacy-access
retirement remain outstanding. A snapshot of the unmodified restore showed the
four Benvenuti tags are referenced only by its cards. Repeat that check at cutover.

`scripts/account-directory.sql` is separate operator-run preparation for an
application DML role and an operator-only view. It requires pre-existing distinct
roles and fails if the application role has administrative, ownership or schema
creation privileges. It has been exercised only on a disposable PostgreSQL instance;
production role separation, credentials, actual application startup and the complete
privilege set require further testing. The application necessarily reads account and
profile tables, so restricting the view alone does not prevent it deriving the same
data from its authorized base-table access.
