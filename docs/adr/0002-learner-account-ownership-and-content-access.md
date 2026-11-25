# Learner account ownership and content access

> Historical decision record. The claim-link and legacy progress-request flows described below were later retired; see [authentication](../authentication.md). The current account model keeps one profile per verified account.

Allow public registration through Google or email/password with required email verification, while separating verified identity, admission, and content permissions. Replace the shared gate's implicit trust with exclusive ownership of personal vocabulary, collections, preferences, and learning records; publish shared vocabulary explicitly rather than expanding the audience of existing content automatically.

Each authenticated learner account owns exactly one learner profile, enforced in the database, instead of supporting family accounts or profile switching. Preserve legacy profile IDs and history through administrator-controlled association, preferably before rollout. If a newly created profile has activity, block automatic reassignment and report the conflict for a separately reviewed migration procedure; preserve both histories and profiles rather than implementing general profile merging.

Shared-library editing permission never grants access to another learner's private collections or progress, and only administrators assign or revoke editor permissions. Explicit editor assignment is available in this release. Preserve the audience of one restricted legacy library with a simple explicit access list, and require administrator review before publishing existing content for all registered learners.

Ordinary card deletion becomes authorised archival, preserving review events, progress, and completed-session history while excluding archived cards from future practice. Collections reference accessible cards without conferring access; personal variants are separate private cards with independent progress. Permanent deletion and account erasure remain separate concerns.

Persist interface language with the account, initialising a missing preference from the current selection; keep accessibility preferences local. Prepare language boundaries with explicit identifiers while retaining the Italian–Greek learning experience and deferring additional language UI. (Additional language UI was later delivered through the curated registry in ADR 0007; this ADR records the original account-ownership scope.)

This changes the former glossary's universal profile selection and editing model. It retains ADR 0001's single application service and private PostgreSQL topology.

The original design used administrator-issued, single-use, expiring claim links as the primary legacy-association flow. An administrator verified identity through a trusted channel and manually shared the link; possession plus a signed-in account authorised an explicit, CSRF-protected confirmation. Token hashes, a 48-hour default expiry, superseded-link invalidation and atomic ownership assignment were specified; GET requests never redeemed claims. Claiming changed neither roles nor legacy-library access. This flow was later retired.

The original design replaced the account's temporary profile association only after proving it is empty across all relevant relationships. Otherwise both profiles and the token were preserved, a pending resolution case and dry-run report were recorded, and merging was deferred. Private, rate-limited legacy-progress requests were specified as a fallback without exposing a profile directory or treating name matches as ownership evidence. This fallback was later retired.

On 4 November 2026 the launch sign-in scope changed from email magic links to
SuperTokens email/password, retaining Google. SuperTokens owns password storage,
verification and reset tokens; Lexi checks verification before application data
access. Google and password identities remain separate even when email addresses
match, with no automatic or client-requested linking. Legacy claim links remain
available as distinct, administrator-authorised associations. Deliver verification
and reset email over HTTPS so Railway Hobby does not require an unapproved
upgrade; hosted provider billing and delivery verification remain release gates.
