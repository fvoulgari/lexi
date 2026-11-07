# Authentication migration and rollback runbook

Operator-controlled instructions only; no production commands were executed to prepare this document. Keep PR #63 draft. Do not merge, tag or deploy until separately authorised. Preserve the single same-origin app/private PostgreSQL topology in [ADR 0001](adr/0001-railway-application-and-private-postgresql.md). The old shared-password instructions in the [release guide](railway-release.md) are superseded by this authentication runbook; image/deployment-ledger controls still apply.

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
