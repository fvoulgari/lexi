# Legacy transition: audit and release gates

Status: **incomplete; not ready to merge or deploy**. This document records
the investigation, not approval to change production.

## Reviewed cutover sequence

Do not execute until final cutover approval. Use the exact reviewed release
image and protected mapping file, and keep credentials out of logs and the
application runtime.

1. Stop and drain application and background writes; verify no writers or
   in-flight write transactions remain. Preserve the existing application image
   and connection configuration for recovery.
2. Capture a fresh protected backup under the freeze, copy it outside the
   database service and volume, restore it to a separate isolated database,
   and compare row-level contents and checksums. Stop if verification fails.
3. In an authenticated Railway console, use a temporary migration identity in
   the one-off operator process. Verify the database name, server identity,
   source schema revision and the four account/profile mappings before any
   write. Run the reviewed Alembic upgrade, then run
   `python -m app.legacy_collection_migration MAPPING --report DRY_REPORT`
   using protected paths. Review the complete report and conflicts. Only if it
   matches the approved plan, rerun with a new protected report path and
   `--apply`; rerun the dry run to verify zero further changes. Revoke the
   temporary identity when finished.
4. Configure the application with a separate restricted runtime role and
   deploy the reviewed image. Verify schema and retirement startup checks,
   all four private collection owners, Fofo/Lollo/Spyros access, publication
   and withdrawal behavior, and unchanged personal history. Verify view
   privileges before describing the account directory as operator-only.
5. Reopen writes only after validation. If validation fails, keep writes
   frozen and assess compatibility before restoring the previous image and
   runtime credential. For data recovery, restore the frozen backup to a new
   database, validate it and redirect deliberately. If writes occurred after
   reopening, preserve and reconcile them before any rollback or redirection.

## Final candidate access rehearsal

On the restored copy on 21 November, application code from commit `731398b`
verified the schema and retirement guard, the three original account/profile
associations, and private access with the legacy-access flag both true and
false. Fofo saw 245 cards in one private collection, Lollo 17 cards in three
private collections, and Spyros no cards or collections. In a rolled-back
publication simulation, Lollo saw 262 cards and Spyros 245; neither could edit
Fofo's cards or see her private tags. A full-row digest of learning progress
was unchanged during the simulation. The final ownership dry run made zero
changes, and its starting manifest exactly matched the previous rehearsal's
ending manifest. Its complete protected report is stored in
`rehearsal_evidence.artifacts` on the restored database as
`candidate-dry-run-731398b.json`. The simulation used SQL to exercise the
application's access rules, not the publication HTTP endpoint; the latter is
covered by synthetic API tests. This copy still shares the production volume.

## Runtime privilege and cutover preparation

On a disposable local PostgreSQL test database, the account-directory test
creates a distinct login without administrative privileges, applies the grants
using the schema owner, and starts the application with that login. It creates
and reads a collection and card, verifies schema creation is denied, and verifies
the operator-only view is denied. This is a synthetic test, not a rehearsal of
the production credential switch. The application still needs base-table
access to accounts and profiles, so view denial does not prevent application
code from querying equivalent information from those tables.

Startup now checks the Alembic revision without performing migrations. For a
reviewed cutover, operators must arrange a separate schema-owner connection,
run the reviewed Alembic upgrade and ownership migration under the write freeze,
apply and verify `scripts/account-directory.sql`, then start the release with
the restricted runtime credential held in Railway's secret store. Validate the
schema check, account login, collection access, practice, writes, and operator
view before reopening traffic. Never put credentials in commands, reports, or
the repository. Keep the former credential protected until rollback is no
longer required; switching credentials alone does not reverse data migrations.
If validation fails, keep writes frozen, restore the previous credential and
compatible application image only after confirming schema compatibility. If a
data rollback is required, restore the frozen independent backup to a separate
target and reconcile any writes before redirecting traffic; do not overwrite the
live database or discard post-cutover activity.

On 21 November the 20 November dump was downloaded through the authenticated
Railway console to a mode-0600 file on the FileVault-encrypted operator computer,
outside the production service and volume. Its SHA-256 matched the original
`7a480103c6db67290dde7aeda0b0acd696eb31430089f43e261341a13907990e`.
It restored successfully into a separate PostgreSQL 18 container with networking
disabled. All 20 tables matched the earlier full-row/count manifest: 19 matched
directly; session-card rows matched using stable `C` ordering on both databases
(the two platforms' default collation ordering differed). This is a verified
independent copy of the 20 November snapshot, not a fresh cutover backup.
No paid resources were provisioned.

The final recovery gate remains a fresh protected backup captured after all
application and background writers have stopped and in-flight transactions
drained. Verify its checksum, restore it to a separate database, and compare
complete data before migration.

Railway documents protected logical dumps uploaded to a private S3-compatible
bucket as an off-volume backup option. Bucket storage is billed at $0.015 per
GB-month, rounded up to whole GB-months; service upload egress is $0.05 per GB,
and any backup or restore worker uses additional compute. Confirm workspace
limits, retention, encryption/key custody and the complete expected cost before
provisioning. Restore the downloaded object to a separate database and compare
its manifest before relying on it. See [Railway's backup guide](https://railway.com/guides/postgres-backups-restores)
and [bucket billing](https://docs.railway.com/storage-buckets/billing).

The release workflow does not perform database migrations. After approval, an
operator runs the reviewed migrations once using an authenticated Railway
console and a temporary owner credential. The replacement application checks
both schema revision and absence of legacy Units/cards before starting. The
runtime must use its separate restricted credential; the deployed application
currently uses a privileged role, so the switch is a required cutover step.
The directory view's production privileges remain unverified until that switch.

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

## Restored-copy ownership rehearsal — 21 November 2026

Exact draft commit `a72a4fd041e6ac3c60654dc7d4eb8a518fa5a14d` was run against
`lexi_transition_rehearsal_20261120`, not the live database. A database-name
assertion preceded both schema upgrade and ownership application. The schema was
upgraded from `b46d77a9d009` to `f80b11e3f013`. Original-column row hashes and
key sets matched across all original tables except the expected Alembic revision
key; `account_deletions` was the only added table. The private mapping ledger
contained the verified account/profile/Unit IDs and complete card-ID sets.

The transactional dry run and application to the copy reported:

| Unit | Owner | Cards / new memberships | Tags | Collection visibility |
| --- | --- | ---: | ---: | --- |
| 00 · Benvenuti | Fofo | 245 / 245 | 4 | private |
| 30 · Foods | Lollo | 8 / 8 | 0 | private |
| 50 · Days | Lollo | 9 / 9 | 0 | private |
| 610 · Lorenzo | Lollo | 0 / 0 | 0 | private |

The row-level comparison identified four new collections and 262 new membership
pairs, and ownership/visibility changes to four Units, 262 cards and four tags.
No other columns or tables changed: card contents and IDs, all 245 existing tag
links, account/profile mappings, reviews, sessions, session snapshots and learning
progress remained identical. Repeating the command produced zero changed rows,
zero new memberships and no new collections.

Scoped ORM queries after the migration showed Fofo could read 245 Benvenuti
cards and four tags; Lollo could read eight Foods and nine Days cards; Spyros
could read none of those cards or tags. The empty Lorenzo collection belonged to
Lollo. In a rolled-back publication simulation, Lollo and Spyros could each read
all 245 Benvenuti cards, neither could read Fofo's private tags, and their full
existing progress rows remained identical. The simulation changed the collection
and confirmed-grant fields inside a transaction and rolled it back; the separate
synthetic HTTP test exercises the owner publication endpoint. This is not an
end-to-end provider-identity or production deployment test.

The mapping and before/after manifests, dry-run, applied and rerun reports are
stored in the separate copy's `rehearsal_evidence.artifacts` table, in a schema
with `PUBLIC` access revoked. They contain identifiers and column hashes and must
remain private. The copy and backup share the production PostgreSQL service and
volume and are not independent disaster recovery. Commit `987db8e` adds a fail-closed check for unmapped legacy Units or cards.
Its exact migration command was rerun against the migrated copy and reported
zero changes; the private report is retained with the other rehearsal evidence.

CI for `a72a4fd` passed, as did local backend (260 passed, one skipped) and
frontend (277 passed, lint and build) checks. Retiring the legacy-access behavior
and replacing the remaining Unit-facing screens still require implementation and
regression coverage. The production operator-view role/credential rollout also
remains unverified and must not be applied from this draft without review.
