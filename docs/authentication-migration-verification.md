# Authentication migration verification

Verified on 4 November 2026 using synthetic data in the existing disposable
`notebook-test-postgres` container (**PostgreSQL 17.11**, `postgres:17-alpine`)
and a separate temporary `lexi-auth-pg18` container (**PostgreSQL 18.6**,
`postgres:18-alpine`). No application database, provider account, or real learner
data was used.

## Backup and restore rehearsal

1. Created two new disposable databases: `lexi_auth_migration_test` and
   `lexi_auth_restore_test`. The concurrently used `lexi_test` database was untouched.
2. Migrated the source database to the pre-authentication revision
   `b46c77a9d008`.
3. Inserted legacy fixtures through raw SQL using the old schema: two learner
   profiles, one unit, one tag and association, two cards, two practice sessions,
   two session cards, two review events and two progress records. The fixture
   covers Italian–Greek Unicode text and both practice directions.
4. Created a real PostgreSQL custom-format backup with `pg_dump -Fc`, restored
   it into the second database with `pg_restore --no-owner --exit-on-error`,
   and compared every original column of every fixture row.
5. Upgraded the restored database to current head `b46d77a9d009` and repeated
   the comparison. All original IDs, timestamps, wording, snapshots, ratings,
   counters and progress values were unchanged.

| Table | Rows preserved |
| --- | ---: |
| profiles | 2 |
| units | 1 |
| tags | 1 |
| entry_tags | 1 |
| vocabulary_entries | 2 |
| practice_sessions | 2 |
| session_cards | 2 |
| review_events | 2 |
| learning_progress | 2 |

The canonical legacy-row comparison had SHA-256:
`8a2c949c793647b193016ada4a0ed1ca694948157febd82737311fd28c79e21d`.
The same representation matched before backup, after restore and after migration.

## PostgreSQL 17 to 18 restore

Repeated the rehearsal with a fresh synthetic pre-authentication source database
on PostgreSQL 17.11. Copied its actual `pg_dump -Fc` output into the isolated
PostgreSQL 18.6 container and restored it using PostgreSQL 18's `pg_restore
--no-owner --exit-on-error`. The original columns and rows matched exactly
before backup, after cross-version restore, and after upgrading on PostgreSQL 18
to `b46d77a9d009`. The fixture row counts were the same as the first rehearsal.

The cross-version rehearsal's canonical legacy-row SHA-256 was:
`39a6246ef3a9465acb09830e9f65cd4d2dc8ba490c6c9c9f8abb1b4a64caf594`.
This is a separate fixture run with fresh timestamps, hence a different hash.
All ownership, audience, constraint, default and archival checks below also
passed on PostgreSQL 18.6.

## Ownership, audience and archival checks

- Both existing profiles became `is_legacy = true`.
- Existing units, tags and cards remained unowned shared content with
  `visibility = legacy`. No content became published and no card became archived.
- Existing cards received explicit `source_language = it` and
  `target_language = el` identifiers.
- A newly inserted account defaulted to `role = learner` and
  `legacy_access = false`.
- PostgreSQL rejected a second account for the same profile, a second account
  with the same provider subject, a private card without an owner, and an
  invalid account role. Each rejection was checked in a savepoint.
- Archiving a reviewed card left every original practice session, session-card
  snapshot, review event and progress row unchanged.

All checks passed in both rehearsals. Each rehearsal removed both databases it
created and all temporary backup files. The temporary PostgreSQL 18 container
and its anonymous data volume were also removed. Existing containers and the
concurrently used test database were unchanged. Managed authentication was
unconfigured at the original rehearsal; it is now configured in staging. This
rehearsal does not verify a live Google callback, email
provider delivery or a production migration. Preserve and verify an actual
production backup before applying the migration there.

## Repeat during staging acceptance

On 4 November 2026, repeated the PostgreSQL 17.11 backup/restore and upgrade
rehearsal against the current checkout. All row counts above, original-column
comparisons, four constraint checks, account defaults, legacy audience and
archival-history checks passed again. The fresh fixture comparison SHA-256 was
`1bae88f5b3250633ac8f99b7495198025af73838cc9539763960d32e2c3106c8`.
Only the two newly created disposable databases and their dump were removed.
This repeat did not rerun the cross-version check or rehearse restoration after
post-cutover writes; those are separate from this result.
