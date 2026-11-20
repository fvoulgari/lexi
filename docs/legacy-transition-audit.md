# Legacy transition: audit and release gates

Status: **blocked; not ready to merge or deploy**. This document records the
initial investigation, not approval to change production.

## Observed on 20 November 2026

- Railway production service `lexi` deployment
  `1fef76d7-6b52-4bce-89b7-a9bf29dcf3b9` is SUCCESS, using image digest
  `sha256:66b6de9af1ddbe3339e2f1f0c67fffcb8de5887a8cd5e07b341c072b58e60e73`.
  The existing production release report identifies that image as v1.2.1.
- Production PostgreSQL is the `Postgres` service in the `lexi` project.
  The attempted read-only SSH connection failed host-key verification before a
  database query could run. No production data was changed. A temporary SSH key
  was registered for the attempt and subsequently removed.
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

## Required before implementation and approval

1. Establish a verified Railway SSH host key and inspect production in read-only
   transactions. Verify each account/profile ID, unclaimed profile, pending
   recovery and conflict; identify the precise source of access to each named
   group and the agreed card ownership mapping. Never infer identity from a name.
2. Take a protected fresh backup and restore it to a separate private database;
   verify schema, privileges and row-level manifests. Keep personal data and
   credentials out of the repository and PR. The prior authentication report
   explicitly does not establish a production-copy restore rehearsal.
3. Rehearse a transactional, rerunnable plan on the restored copy. Compare IDs,
   card contents, memberships, ownership, audiences, profiles, reviews, sessions,
   snapshots and learning progress, including intended differences. Stop on
   ownership conflicts or unexpected changes; retain records and access.
4. Prepare and test the claim retirement, account directory, collection
   unification and an operator path for active controls. Validate all three
   learners' access and personal progress and negative authorization cases.
5. Present sanitized dry-run and restoration evidence for review. No production
   mutation or deployment is authorized until the reviewed plan is approved.
   Coordinate a final write freeze and backup immediately before an approved
   cutover, accounting for concurrent writes as described in the authentication
   migration runbook.
