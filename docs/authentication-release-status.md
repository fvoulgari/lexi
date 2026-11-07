# PR #63 closeout — 7 November 2026

PR #63 remains **draft**. No merge, production deployment, production migration,
paid provider upgrade or production threshold change is authorised. Collections
remain separate in #65. This is the current summary; older dated investigations
record earlier configurations, not additional current failures.

## Implementation and local verification

Authentication/account isolation, credential-aware settings, password change,
non-enumerating recovery, administrator-controlled legacy claims, archival and
migration safeguards are implemented. SuperTokens stores passwords; Lexi does
not implement hashing or merge identities merely because emails match.

Fresh checks on source `320a0cb9cfd520e3eb30e66f37461ab85d4327f6`:

| Check | Result |
| --- | --- |
| Full backend, including isolated real Core integration | PASS: 217 tests, none skipped |
| Frontend | PASS: 262 tests across 20 files |
| Ruff / ESLint / frontend build | PASS; existing Starlette/httpx deprecation and bundle-size warnings remain |
| Synthetic PostgreSQL 17.11 dump, restore, auth upgrade | PASS: `b46c77a9d008` → `b46d77a9d009`; original IDs, timestamps, references, reviews, snapshots and progress preserved |
| Account/profile uniqueness, role defaults, private-owner constraints and archival preservation | PASS in migration rehearsal |
| GitHub CI for `320a0cb` | PASS: backend/frontend/application/image checks; production/publishing jobs skipped. [Run 42315206640](https://github.com/fvoulgari/lexi/actions/runs/42315206640) |

The real Core integration used cached official image `c74eef1f69b7` in an
in-memory, loopback-only disposable container, with Argon2 and a two-second reset
lifetime. It verified registration/verification and reset/reuse/expiry, generic
responses, provider-backed credential handling, long-Unicode non-truncation,
separate same-email Google/password identities, Google-only recovery behavior,
password-change current-password checks, session revocation and logout. Google
identities were created through provider test APIs; this is not a live OAuth
callback test. Email transport was captured, not delivered. The container was
stopped/removed afterward. No managed Core configuration changed.

Migration comparison SHA-256:
`a6ac2693458e446befb5e22cfc58bc6cde2296a3bacdf869082d4bb51a605db9`.
Both temporary databases and the dump were removed. See the
[migration evidence](authentication-migration-verification.md) and
[production runbook](authentication-migration-runbook.md).

## Hosted staging evidence

Active origin: **https://staging-lexi.fotiniv.com**.
Tested source `0503808`, deployment `394e6aa3-941d-4217-8313-2d8fc52262ed`;
read-only recheck still reports SUCCESS. Runtime source hashes previously matched.
Later commits through `320a0cb` add tests/evidence, not different runtime code.

| Check | Result / evidence type |
| --- | --- |
| Health and provider readiness | PASS, automated: 200; auth_available=true |
| Logged-out profile/vocabulary data | PASS, automated: 401 |
| Isolated Tunnel ingress | PASS: loopback listeners; no Railway public domains/TCP proxy; private IPv4/IPv6 app and metrics probes blocked |
| 5/60 rate limit | PASS: A receives 429 on sixth request; mobile-data B remains independent (B manually reported); forwarding-header probes cannot select another application bucket |
| Missing/invalid/duplicate CF identity | PASS, deployed boundary: 400; no header fallback |
| Google login and Google-only settings | PASS, manual user report on new origin |
| Fresh registration, blocked unverified access, delivered verification and subsequent access | PASS, manual user report on new origin |
| Delivered reset, correct hostname, reset and new-password sign-in | PASS, manual user report on new origin |
| Used reset link | PASS, manual rejection reported |
| Private-card search isolation | PASS, manual: A created synthetic private card, B could not find it. This is not a direct-ID/export/write or progress-isolation trace |
| Logout-all / unrelated identity | PASS, manual: two password-account sessions signed out; separate Google account remained signed in |
| Password change and two-session invalidation | Earlier staging manual PASS; not repeated on the Tunnel origin |

Browser/version, authenticated HTTP traces and exact phone timing were not
recorded for manual results. Forged CF header probes returned Cloudflare 403;
that proves upstream rejection for those probes, not successful header replacement.
See [full ingress/cost/rollback evidence](authentication-tunnel-staging-results.md).

## Deliberately skipped and not verified

The user explicitly chose to **skip hosted admin testing** on 7 November.
No staging administrator was bootstrapped or promoted. Do not count these as PASS:

- Hosted administrator/editor role assignment, revocation and restricted-library
  transitions.
- Hosted administrator-issued legacy claim continuation, redemption, revocation,
  activity conflict and race scenarios. Local claim transaction/concurrency tests
  pass, but they do not establish that hosted flow.

Also not verified on the current hosted origin: access/refresh expiry and renewal,
verification-link reuse/expiry, managed reset expiry, token/account-confusion cases,
reset-driven revocation of already active sessions, broad signed-in direct-ID/CSV/
bulk/progress isolation and complete cookie/edge-log inspection. Local regressions
and the real disposable Core cover parts of these behaviors; they are not hosted
PASS evidence. An actual Railway process restart/failure-injection rehearsal has
not been run; local supervisor failure cleanup and hosted health/readiness passed.

## Independent review scope

Two independent read-only standards/spec reviewers inspected through `95c4034`,
including authorization, account isolation, claims, migrations and password change;
no new concrete defect was established. Those reviewers did not execute tests or
verify hosted configuration. The subsequent Tunnel/password-backoff changes have
local and hosted tests as recorded above, but were not covered by that earlier
independent review. Do not imply its scope includes later commits.

## Production prerequisites — not performed

1. Confirm approved managed Core production billing, supported hashing and actual
   token/session lifetimes. Development bcrypt is not evidence for the unchanged
   15–128-character Unicode policy; verify managed Argon2/non-truncation before
   real registrations. See [hashing requirements](authentication-hashing.md).
2. Approve and verify production ingress separately. The Tunnel supervisor is
   intentionally restricted to the staging environment ID; setting its mode in
   production is not a supported rollout. Direct-mode Railway peer-based throttling
   retains the demonstrated limitation. Do not open production public signup based
   solely on this staging POC or silently relax that guard.
3. Resolve acceptance of skipped/unverified hosted checks explicitly, then select
   exact release image, actual production backup/restore evidence, administrator
   bootstrap and legacy mapping using the runbook. Do not use a real learner for a
   test claim. Rehearse reconciliation of post-cutover writes before rollback.

Implementation closeout is distinct from production readiness. Keep draft and
public-signup release gate unchanged; no automatic promotion follows this report.
