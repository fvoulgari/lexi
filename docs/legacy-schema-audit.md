# Post-cutover legacy schema audit

Production was inspected read-only on 21 November 2026. The deployed v1.2.2
image is `ghcr.io/fvoulgari/lexi@sha256:90de77e077c97d3ccecdd52dd93fbf336a30b9c794e3edd0aab59006def6320d`,
corresponding to the reviewed merge commit `69dd0078aa1368e6bec652c4a45d927486730034`.
The proposed migration is **not applied to production**.

| Structure | Live observation | Decision and dependency |
| --- | --- | --- |
| `units` and `vocabulary_entries.unit_id` | Four Units; all 262 cards reference a Unit. The foreign key is `ON DELETE RESTRICT`. | Retain. Card creation, imports, compatibility filters, bulk operations and account deletion still use Units. Session-card snapshots are retained independently; do not infer that the FK is disposable from the Collections UI. |
| `legacy_claim_links` | Three consumed claim records. | Retain completed claim audit records and their profile/account foreign keys. Claim routes are retired, but account deletion still references these records. |
| `legacy_progress_requests` | Three records, including **one pending** and two resolved. | Retain. The pending request remains an exception for an operator to review; do not discard or silently resolve it. Account deletion also uses this table. |
| `legacy_resolution_cases` | Zero records. | Retain. Account deletion checks for cases involving other accounts and refuses unsafe deletion; emptiness alone does not remove that dependency. |
| `legacy_claim_continuations` | Zero records. | Retain. Account deletion still queries it, and its structure supports historical migrations and restore compatibility. Its expiry index is a cleanup candidate below. |
| `gate_sessions` | Two expired rows. | Retain the rows and table as security history. No active runtime reader of `GateSession` was found. Its expiry index is a cleanup candidate below. |
| `accounts.legacy_access` | True for all three accounts. | Retain for now: account provisioning and the ORM still write/read the column. The access flag no longer grants library access in v1.2.2; dropping the column requires a separately deployed compatibility change. |
| `profiles.is_legacy` | Column remains alongside claimed and other profiles. | Retain profile associations and history; the label is not authority to delete or merge profiles. |
| `security_events`, `login_throttles`, `account_directory` | Security and operator structures remain. | Retain. The runtime is denied the operator directory view; security events and login throttling support current security behavior. |

The legacy claim-management module remains in the source tree but is not mounted
as an active router. Its records are nevertheless used by current account-deletion
logic. Historic Alembic revisions also mention the retained tables; preserve them
for upgrades from older backups. The operator grant script still enumerates these
tables, another reason not to remove them without a coordinated release.

## Proposed cleanup

Revision `a91c73f4a014` removes only two non-unique B-tree expiry indexes:
`ix_gate_sessions_expires_at` and
`ix_legacy_claim_continuations_expires_at`. Their old expiry-cleanup flows are
retired; current account deletion looks up continuation records by token hash,
not expiry. Production statistics reported zero scans for both indexes, but
statistics can reset and are supporting evidence only. Both table definitions,
primary keys, data, other indexes, grants, foreign keys, views and audit records
remain. The migration refuses unexpected index definitions and can restore the
indexes on downgrade. Removing these indexes may slow a restored older version's
expiry maintenance; it does not remove its data or prevent the query running.

On a network-isolated PostgreSQL 18 restore of a fresh post-cutover snapshot,
full per-row and per-column manifests matched for every table other than the
expected Alembic revision change. The 3 accounts, 9 profiles, 4 collections,
262 memberships and cards, 4 tags, 245 tag links, 28 reviews, 7 sessions,
350 session-card snapshots, 28 progress records, 4 Units, 2 gate rows and all
claim/recovery records were unchanged. Foreign keys, the account-directory
view definition and its runtime/operator SELECT privileges also matched.
A downgrade restored both indexes, and re-upgrade succeeded. The snapshot was
taken while production remained online, so it is a consistent rehearsal point,
not a replacement for the frozen cutover recovery backup.

Before any future production migration, confirm the deployed application and
schema still match this audit, review any new dependencies or pending records,
take and verify a fresh protected backup, and follow the documented operator
migration and recovery process. Do not apply this migration as a blanket cleanup.
