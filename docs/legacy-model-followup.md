# Legacy model retirement and account deletion

This draft is stacked on PR #76. Its migrations must run after #76; do not
apply them to production without a separately reviewed plan and backup.

## Historical records and compatibility

Keep account/profile links, cards, tags, collection memberships, reviews,
sessions and progress for active accounts. Unit records and existing card
`unit_id` links are temporary compatibility structures for old API/CSV clients;
collection-created cards no longer need a Unit. The physical `legacy_access`
column remains unchanged for compatibility but application provisioning and
its account ORM no longer use it as a control.

Claim links, recovery requests, resolution cases and security events record
historical security actions. Existing records and associations remain unchanged
for active users. Lollo's request preceded his completed claim and referred to
his linked profile. On 21 November 2026 the operator rechecked these facts and
marked the request resolved, recording the reason; neither the request nor the
completed claim was deleted.

## Account deletion and retention

Deletion removes the requested account and its profile, owned collections,
unshared owned cards/tags/Units and its personal reviews, progress and sessions,
and queues deletion of the authentication-provider identity. The existing
hashed provider-subject tombstone remains to prevent re-provisioning; its
provider subject is cleared once external deletion succeeds. Security events
retain their event and timestamp but their deleted actor link is cleared.

Recovery records stay as security history but links to a deleted account or
profile become null; the deleted account's recovery request name is replaced
with `[deleted]` and its free-text note is erased. Claim hashes and event times
remain as security audit data; they are not a copy of the profile or the note.
This policy does not set an expiry for those minimized security records. A
separate retention policy may later define one; do not silently erase active
users' audit records. Other accounts' associations remain intact.

The minimal `recovery_case_guards` table retains only case, account and profile
IDs required to enforce the existing cross-account conflict guard. It contains
no name, request text or claim token. Its account foreign key cascades on
account deletion. It is populated from the retired cases once; claim/case
creation has been disabled. If any other account's case refers to the profile,
deletion is blocked as before.

Deletion is also blocked when an owned card is referenced by another account's
collection, review, progress or practice snapshot, or when an owned tag is
attached to another account's card. This preserves other learners' data; an
operator must resolve those dependencies before deletion. The account and all
other records remain unchanged on a blocked attempt. It does not automatically
transfer ownership or publish content.

## Rehearsal and sequencing

A protected post-cutover snapshot was restored to an isolated database and the
stacked #76 and follow-up migrations applied. Before/after row-and-column hash
manifests show unchanged existing records; only the Alembic version and the
new, initially empty guard table differ. A rollback-only test exercised account
deletion and request anonymization on the restored database. Automated tests
cover conflict and shared-progress guards; see the draft PR for current suite
results and remaining review work. Repeat against a fresh backup before any
production migration.
