# Legacy model retirement: staged follow-up

This is a proposal and isolated rehearsal, not authority to change production.
Keep PR #76 independent; if it merges first, rebase this branch's Alembic
revision onto its head, then repeat the restore and compatibility tests.

## Data retained and temporary compatibility

Keep claim links, recovery requests, resolution cases and security events as
historical security/recovery evidence. The pending Lollo request predates his
completed claim (20 November 2026, 22:21 UTC versus 22:47 UTC), refers to his
currently linked profile, has no note and no pending resolution conflict. It
appears redundant, but should be explicitly reviewed and marked resolved with
an operator and timestamp; never silently delete it. This proposal does not
change it.

Keep account/profile links, cards, tags, collection memberships and all review,
session and learning progress data. Units and the vocabulary `unit_id` foreign
key are compatibility structures: existing values must stay intact while old
CSV and API clients still use them. New collection cards need not invent a
Unit. The physical `accounts.legacy_access` column is temporarily retained
with its existing values even though application provisioning and the account
ORM no longer use it. It is not an authorization control.

## Deletion dependency: further design required

The existing deletion path directly deletes claim links, continuations, requests
and cases, and blocks deletion if another account's resolution case references
the profile. Foreign keys from these records to accounts and profiles prevent
simply removing those queries. Cascading or dropping them would lose evidence;
merely switching them to SET NULL would lose the original associations and
could weaken the existing conflict guard.

A separate migration should first copy complete claim, request, continuation
and resolution records, including original IDs and relationships, to a
permanent, access-restricted audit store, verify row-for-row equality, and
preserve the cross-account deletion guard against that store. Then make the old
foreign keys detachable on account/profile deletion while keeping original IDs
in the audit store; migrate the deletion path to the permanent audit interface.
Test account deletion for pending and completed cases, other-account conflicts,
actor deletion, concurrent requests, and audit preservation. Decide and document
the retention and privacy treatment of notes before implementing this step.
No table should be dropped until compatibility clients and recovery needs have
been independently verified. The current branch does not implement that step.

## Rehearsal

A post-cutover production snapshot was restored to an isolated local PostgreSQL
container. The candidate migration made `vocabulary_entries.unit_id` nullable;
row/column hash manifests captured before and after matched for every table
except `alembic_version`, which changed to the new revision. The migration
does not alter existing card IDs, values, memberships, tags, owners, profile
links, requests, reviews, sessions or progress. Test results are reported
separately; this evidence is not a substitute for a fresh pre-cutover backup.
