# Authentication migration and rollback runbook

Execution on 20 November 2026 is recorded in the [production report](authentication-production-release-2026-11-20.md), including the explicitly waived production-copy restore rehearsal. The instructions below remain the rollback/preparation reference; their original draft restriction was superseded by explicit rollout approval.

Original preparation context: operator-controlled instructions only; no production commands were executed to prepare this document. Keep PR #63 draft. Do not merge, tag or deploy until separately authorised. Preserve the single same-origin app/private PostgreSQL topology in [ADR 0001](adr/0001-railway-application-and-private-postgresql.md). The old shared-password instructions in the [release guide](railway-release.md) are superseded by this authentication runbook; image/deployment-ledger controls still apply.

## Preparation and rehearsal

1. Record the approved application commit and immutable image digest, current image digest, PostgreSQL major version, schema revision, selected private database identity and restore destination. Confirm [provider setup](authentication-setup.md), costs and [staging acceptance](authentication-staging-checklist.md). Never paste credentials or full connection URLs into tickets/logs.
2. Confirm the expected pre-authentication revision is `b46c77a9d008`. Ownership migration is `a35c66f8c008`; claims migration/head is `b46d77a9d009`. If production is on another revision, stop and review the complete path. Do not stamp revisions to bypass checks.
3. Arrange a maintenance/write freeze: stop existing writers, jobs and old app replicas before the final backup; retain the freeze through validation. Merely hiding UI is not a database write freeze. Have enough private capacity and time to restore to a replacement database. Do not create billable resources without approval.
4. Use matching PostgreSQL client tools (a `pg_dump` version must support the source server) on a trusted private connection. An authorised operator supplies `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGSSLMODE` and authentication through a protected password file/secret facility. Do not pass passwords in shell arguments or enable shell tracing. Confirm target identity privately before every command.

The following examples are **not automatic scripts**. They assume the operator has privately selected the correct database, a protected backup directory and variables `LEXI_BACKUP_FILE` / `LEXI_RESTORE_DATABASE`. They print no connection secrets. A backup and report contain learner data: protect access, encrypt storage and follow retention policy.

```sh
# Source connection is already selected privately; write to protected storage.
umask 077
pg_dump --format=custom --file="$LEXI_BACKUP_FILE"
pg_restore --list "$LEXI_BACKUP_FILE" > "$LEXI_BACKUP_FILE.contents"
# Deliberately switch private PG connection to the NEW restore server first.
# LEXI_RESTORE_DATABASE must be a new empty name, never the source database.
createdb "$LEXI_RESTORE_DATABASE"
pg_restore --no-owner --exit-on-error --dbname="$LEXI_RESTORE_DATABASE" "$LEXI_BACKUP_FILE"
```

Listing an archive is not proof of recovery. Restore and verify it. If roles differ, review grants/ownership explicitly; `--no-owner` does not validate application privileges. Never restore over the live source. Record backup checksum, timestamp and write-freeze boundary privately, without publishing the backup.

5. Select the restored database in private `DATABASE_URL` for the checked backend/container. From its backend working directory, inspect `alembic current`, then run `alembic upgrade head`. Startup also runs `alembic upgrade head` before Uvicorn; **starting the new image against a selected database mutates its schema**. Rehearse on the replacement first, not by experimenting against production.
6. Run `python -m app.admin_tools legacy-report` on the restored upgraded database. Keep its learner names/history counts private. Compare every legacy profile ID and original review/session/progress/wording/snapshot relationship before and after; verify restricted legacy visibility, unowned shared content, `it`/`el` identifiers, unarchived defaults and one-to-one account constraints. No content is automatically published, and profiles are not automatically matched by names/email.
7. Exercise practice in both directions and archive/restore against synthetic fixtures, plus negative authorisation and claim concurrency cases. Existing [migration verification](authentication-migration-verification.md) reports synthetic PostgreSQL 17.11 and 18.6 restore/upgrade rehearsals, **not production-data validation or a live provider test**. Repeat validation against an authorised protected production backup before rollout; never send that data to provider test users.

## Authorised cutover and bootstrap

1. While writes remain frozen, take and verify the final backup; a rehearsal snapshot taken earlier is insufficient. Upgrade only the deliberately selected target database with the approved image. Never run old and new app versions as competing writers across the ownership boundary. Confirm `alembic current` reports `b46d77a9d009`.
2. Start only the compatible new application with environment-specific provider credentials. Readiness must succeed, but health alone is insufficient: verify real sign-in, authorised data access and both users' isolation before reopening writes. Preserve sanitised evidence and the exact maintenance boundary.
3. To bootstrap the first administrator, sign in through the real provider to create its account. Privately obtain that account's exact stable SuperTokens subject from the verified provider record; never guess from email or display name. With `DATABASE_URL` explicitly selected, run the following from the backend environment:

```sh
# Operator supplies this verified identifier privately; it is not a credential.
python -m app.admin_tools bootstrap-admin --subject "$LEXI_VERIFIED_SUBJECT"
# Inspect the account/profile identifiers and proposed role before applying.
python -m app.admin_tools bootstrap-admin --subject "$LEXI_VERIFIED_SUBJECT" --apply
```

The first command is a dry run. The tool refuses a different bootstrap once an administrator exists and records application of the role. It grants no restricted-library access. Use authenticated admin controls thereafter; assign legacy access and editors explicitly and separately.

4. Map known legacy users via identity verification and individual claim links before broader rollout where practical. Manually deliver links only through the verified channel; no bulk email/name inference. If a new profile has any learning activity or owned content, stop automatic association and retain both profiles and histories; use the dry-run conflict report for a separately reviewed migration. Do not force mappings or retire profiles.
5. Reopen writes only after acceptance; monitor auth failures, HTTPS email delivery, permissions and provider quotas with secret-free telemetry. Keep original database and verified backups until the rollback window and reconciliation obligations are satisfied.

## Rollback decision and recovery

Ownership and claims migrations intentionally reject downgrade. Never run `alembic downgrade`, delete ownership/claims tables, or point an old shared-gate image at the isolated schema. An application-image rollback alone cannot safely reverse this release.

1. Freeze writes again and preserve the failed/upgraded database, security events and a protected fresh backup for investigation. Record all writes since the pre-cutover snapshot. Revoke affected provider sessions if exposure is suspected; restoring application data does not rewind Core identities/sessions.
2. Before authorising recovery, assess loss of **all post-cutover writes**, including registrations, private cards/collections, preferences, reviews, claim ownership and role/access assignments. A pre-change restore lacks these records. Do not silently discard them. If safe reconciliation is not understood, keep maintenance mode and fix forward or obtain a separately reviewed reconciliation procedure.
3. Restore the verified pre-change backup into a **new private database** using the restore steps above. Validate schema `b46c77a9d008`, original IDs/counts/history and application privileges. Retain the upgraded database unchanged. Select an old application image known compatible with that pre-auth schema; its previous shared access model requires a restricted maintenance audience, not public registration.
4. Under the approved recovery procedure only, change the private database connection and compatible image together, following the release guide's deployment/ledger controls. Remove incompatible provider/public-registration routing, verify no isolated/private data is exposed and do not reuse the upgraded schema. Recovery has not completed until observed application behavior, data validation and explicit post-cutover reconciliation/loss assessment are recorded.
5. Keep backups, the original isolated database and deployment records protected for investigation/recovery. Do not destroy provider accounts, force claims or attempt a general profile merge as a rollback shortcut. Re-enable public access only after a reviewed plan restores the intended security model.

## Production comparison ledger and write accounting

The 7 November synthetic rehearsal is a completed **local** dump → separate
restore → auth migration exercise. It is not a rehearsal on a protected production
backup. The latter is **NOT RUN**. Before running it, obtain approval for the
specific source backup, private restore destination, data access, encryption,
retention and any additional database cost. Do not attach dumps, learner names,
provider subjects or row-level manifests to GitHub. No restored learner data may
be exposed through the public staging app or assigned to provider test identities.

Create the baseline under a repeatable-read, read-only transaction after the
write freeze. Store a protected manifest of primary keys, original column names
and canonical row hashes, plus row counts, schema revision, timestamp, PostgreSQL
version and backup SHA-256. Order rows by the complete primary key; serialize
JSON with stable key order and retain exact UTC timestamp precision. Compare the
same original columns on the restored copy before migration, and again after
migration. Added auth columns are checked separately, not discarded from review.
A count-only match cannot establish preservation.

| Table/data | Required exact comparison |
| --- | --- |
| `profiles` | complete original profile-ID set, display names, preferences, timestamps |
| `vocabulary_entries` | complete original card-ID set, text, unit references, grammar fields and original timestamps |
| `units`, `tags`, `entry_tags` | original IDs, classification and exact membership pairs |
| `practice_sessions`, `session_cards` | IDs, learner/direction, ordering, card references, reveal state, every stored snapshot |
| `review_events` | event IDs, profile/card/session/position/direction, rating, timestamp, snapshot; no lost or duplicated event |
| `learning_progress` | full `(profile_id, entry_id, direction)` key set; review/rating counts, weighted sums/weights and last-reviewed timestamps |
| existing `collections` / `collection_entries`, if present | IDs, owners and membership pairs unchanged; do not apply #65 schema/visibility behavior |
| added ownership/audience/language columns | original shared content remains unowned `legacy`, never automatically `published`; original profiles remain legacy; expected `it`/`el` mapping and no unexpected archives |
| new accounts/claims | one provider subject ↔ one account ↔ one profile, explicit roles/access only, no name/email-derived assignment |

Record intentional invalidation of obsolete `gate_sessions` separately; old shared
login sessions must not survive as authenticated accounts. Operational limiter
rows are not learning history. Never silently exclude an unexpected original table
or column; investigate schema differences before migration.

Use `legacy-report` only on the private restored database and keep its output
protected. Verify every planned mapping in a private ledger: stable provider
subject, new account ID/current profile ID, legacy profile ID, identity-verification
basis, dry-run activity counts, proposed action, approver and timestamp. A new
account starts learner-only with no editor/legacy access. Claims grant association
only. For an active replacement profile, stop and retain both histories for a
separately reviewed migration; do not apply a merge, delete activity or infer
ownership from matching names. Assign editor/legacy-library access separately.

### Freeze and post-cutover boundaries

1. Record freeze start `T0`, stop every old app replica/import/job/admin writer,
   and confirm there are no active writer transactions or other application
   connections capable of writes. Restrict old writer credentials/network access;
   a maintenance page alone is insufficient. Use a distinct migration connection.
2. Dump and restore the frozen final source into a new private target. Record
   checksum and compare manifests. Migrate and validate while writes remain frozen;
   stop on any unexpected difference. The source remains intact and inaccessible
   to normal writers. Do not allow public test users onto restored learner data.
3. Complete approved mappings and synthetic smoke checks. Capture a second
   protected manifest immediately before reopening writes (`T1`), accounting for
   each approved mapping/audit mutation. Record exact image digest and private
   target identity. A protected backup rehearsal from earlier is not this final
   frozen backup.
4. On reopening, the migrated target is the sole writer. Record `T2`. Preserve a
   recovery window with backups/WAL or equivalent protected point-in-time recovery
   where supported and approved; verify retention rather than assuming it exists.
5. If rollback is considered, freeze again (`T3`) and take a fresh protected dump
   of the upgraded database plus a full row/key diff against `T1`. This captures
   inserts, updates and deletions, including records without `updated_at`; timestamp
   filters alone miss changes. Inventory new accounts/provider subjects, private
   cards/collections, reviews/progress, settings, claims and permission changes.
6. Preserve that upgraded database and Core separately. Do not replay progress
   counters alone: reconcile accepted review event IDs exactly once, then verify
   derived direction-specific progress; preserve edits/deletions and ownership
   without exposing private content in the old shared model. Claim/role/account
   changes may not have a safe pre-auth representation. Keep maintenance and fix
   forward unless a separately reviewed transformation/loss decision covers them.
7. Prove the post-`T2` inventory is fully reconciled (or obtain explicit informed
   acceptance of specific losses) before pointing users to a pre-change restore.
   Restoring the `T0` backup does not undo Core identities, passwords or sessions.
   Revoke incompatible sessions as required. Never run the old image on the
   upgraded schema, downgrade ownership tables, or reopen an unprotected origin.

Evidence closing the production-backup rehearsal gate: private backup/restore
identities and checksum, successful restore and upgrade, exact original-column
manifests, reviewed new-column audience/ownership checks, protected mapping dry-run,
verified application privileges, synthetic-only smoke trace, and a demonstrated
post-cutover delta/reconciliation procedure. Publish only sanitized counts/results
and the tested commit/image digest in the release record.
