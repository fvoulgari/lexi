# Retired claim-table cleanup

This is a proposed migration, not a production operation. The fresh, protected
PostgreSQL 18 snapshot was taken on 21 November 2026 while production remained
online, so it is a consistent rehearsal snapshot rather than a final cutover
backup.

The migration removes exactly two tables, and only if both are empty:

- `legacy_claim_continuations`, formerly used by the disabled claim flow.
- `legacy_resolution_cases`, formerly used by the disabled recovery flow.

It locks both tables before checking, aborts if either contains a row, and drops
neither on a failed check. It retains `recovery_case_guards` and the
cross-account deletion protection. The unmounted claim router is removed; the
operator's read-only profile report and administrator bootstrap remain.

Keep `legacy_claim_links` and `legacy_progress_requests` for the existing claim
and recovery history, including Lollo's resolved request. Keep `gate_sessions`
for its security history. Keep Units and their existing card references for
compatibility, plus all accounts, profiles, collections, cards, tags, reviews,
sessions and progress. This change introduces no archival system.

On the fresh isolated restore, both candidate tables contained zero rows and
had no incoming foreign keys. Before/after per-row and per-column manifests
matched for every retained table. Only those two table removals and the Alembic
version changed. In particular, all 3 accounts, 9 profiles, 4 collections,
262 collection memberships and cards, 4 tags, 245 tag links, 28 reviews,
8 sessions, 360 session snapshots and 28 progress records were unchanged.
Lollo retained all 18 of his progress records. The runtime remained unable to
read `account_directory`; the operator could read it, and the runtime retained
its guard-table read grant.

The migration intentionally refuses automatic downgrade: review and restore a
backup if the old structures are needed. Before any separately approved
production change, take and restore-test a fresh frozen backup, recheck that
both tables are empty, and run the migration with the authorized operator
identity. Do not apply this proposal to production as part of this PR.
