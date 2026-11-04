# Learner account ownership and content access

Allow public registration through Google or verified email magic links, while separating verified identity, admission, and content permissions. Replace the shared gate's implicit trust with exclusive ownership of personal vocabulary, collections, preferences, and learning records; publish shared vocabulary explicitly rather than expanding the audience of existing content automatically.

Each authenticated learner account owns exactly one learner profile, enforced in the database, instead of supporting family accounts or profile switching. Preserve legacy profile IDs and history through administrator-controlled association, preferably before rollout. If a newly created profile has activity, block automatic reassignment and report the conflict for a separately reviewed migration procedure; preserve both histories and profiles rather than implementing general profile merging.

Shared-library editing permission never grants access to another learner's private collections or progress, and only administrators assign or revoke editor permissions. Explicit editor assignment is available in this release. Preserve the audience of one restricted legacy library with a simple explicit access list, and require administrator review before publishing existing content for all registered learners.

Ordinary card deletion becomes authorised archival, preserving review events, progress, and completed-session history while excluding archived cards from future practice. Collections reference accessible cards without conferring access; personal variants are separate private cards with independent progress. Permanent deletion and account erasure remain separate concerns.

Persist interface language with the account, initialising a missing preference from the current selection; keep accessibility preferences local. Prepare language boundaries with explicit identifiers while retaining the Italian–Greek learning experience and deferring additional language UI.

This changes the former glossary's universal profile selection and editing model. It retains ADR 0001's single application service and private PostgreSQL topology.

Use administrator-issued, single-use, expiring claim links as the primary legacy-association flow. An administrator verifies identity through a trusted channel and manually shares the link; possession plus a signed-in account authorises an explicit, CSRF-protected confirmation. Store only token hashes, default expiry to 48 hours, invalidate superseded links, and perform ownership assignment and token consumption atomically. GET requests never redeem claims. Claiming changes neither roles nor legacy-library access.

Replace the account's temporary profile association only after proving it is empty across all relevant relationships. Otherwise preserve both profiles and the token, record a pending resolution case and dry-run report, and defer merging. Provide private, rate-limited legacy-progress requests as a fallback without exposing a profile directory or treating name matches as ownership evidence.
