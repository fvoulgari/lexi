# Authentication staging acceptance checklist

Latest staging ingress evidence: [Tunnel POC results](authentication-tunnel-staging-results.md).
The active staging origin is `https://staging-lexi.fotiniv.com`; historical records
below retain their original deployment/origin. Google login/settings passed by manual user report on the new hostname. Reset email delivery, the new-hostname reset link, and new-password sign-in
also passed by manual user report. Used reset-link rejection also passed manually. Fresh registration, blocked
unverified access, verification email/new-hostname link and subsequent access
passed manually. Manual logout-all revoked both password sessions while Google stayed signed in;
A's private card was absent from B's search. Broader isolation, expiry and renewal
checks remain unverified. Hosted admin/claim tests were explicitly skipped by the
user on 7 November. See the [current closeout](authentication-release-status.md).

Run only after [provider setup](authentication-setup.md), with disposable synthetic learners, vocabulary and legacy profiles. Keep separate staging Core, Google client and database; stay within verified free quotas. This checklist is **pending**, not a claim of end-to-end success. Local mocked-provider tests and migration rehearsals do not verify Google, delivered email, cookies or live Core.

Managed development Core currently exposes hashing configuration as read-only.
Its bcrypt setting does not block restricted synthetic functional tests using
15–64 ASCII-character passwords. Record that constraint and actual read-only
lifetimes; keep long-password/Unicode non-truncation and production hashing checks
separate and pending. See [hashing investigation](authentication-hashing.md).
Do not open this constrained test deployment to real-user registration.

Record each result as PASS / FAIL / NOT RUN with date, tested commit/image, browser, non-secret environment identifier and sanitised evidence. Never attach link tokens, callback queries, cookies, credentials, personal emails or unredacted traces. A failed or inaccessible CI run is not a pass.

## Account settings staging follow-up — 4 November 2026

Commit `7ad367955312c42fe6c4cdc66d2aa9240fa09415` deployed successfully as
`47e33666-ecb8-4039-9f70-c53d1b254c73` after explicit user approval. Health and
session readiness passed; unauthenticated credential access returned 401. A real
Chromium browser verified reset acceptance for an unknown synthetic address:
conditional message, plain submitted email, removed form and no notebook
navigation. No delivery was verified. The user subsequently reported PASS for
incorrect-current-password rejection, a successful password change signing out
two browser sessions, rejection of the old password and acceptance of the new
password on this deployment. This is manual user evidence; browser/version was
not recorded. The user also confirmed prior Google sign-in testing and that
Change password appears only for their password-registered account, not the
Google-only account (manual PASS). Exact label wording was not confirmed.
Other signed-in account-card checks, unrelated-session isolation,
renewal remain pending. The user subsequently confirmed verification and reset
email receipt/use and rejection on link reuse (manual PASS); expiry timing was
not established. See [release evidence](authentication-release-status.md). Its CI passed; production jobs were skipped.
See [account verification](account-settings-verification.md).

## UI follow-up — 4 November 2026

UI commit `53d1d8bb6cbe26153a7561d3ffcde134ee61be07` deployed successfully as
`0a46404a-d6e2-444a-b34b-238543680168`. A real Chromium browser at mobile width
verified sign-in, the live generic wrong-credential banner, retained email,
re-enabled controls and registration/recovery navigation. No delivery or account
creation was initiated. Its CI passed; production jobs were skipped. See
[UI verification](authentication-ui-verification.md). All untested acceptance
items below remain pending.

## Hosted retry — 4 November 2026

After the user deployed the provider variables, staging deployment
`031116af-fb62-408d-b4d9-2085cda1cd66` reached SUCCESS. Programmatic HTTPS
checks confirmed the following; no browser credentials or email tokens were read.

| Check | Result |
| --- | --- |
| Health / frontend | PASS: HTTP 200 |
| Session configuration | PASS: auth available, unauthenticated |
| Logged-out profiles and vocabulary | PASS: HTTP 401 |
| Password sign-in against managed Core with nonexistent synthetic identity | PASS: generic WRONG_CREDENTIALS_ERROR, no-store |
| Google authorization initiation | PASS: HTTP 200 / OK; actual Google login NOT RUN |
| Removed code-create and public code-consume endpoints | PASS: HTTP 404 |
| Sign-in with foreign Origin | PASS: HTTP 403 |
| Registration, delivered email, Google callback and authenticated data tests | NOT RUN: requires human test inbox / Google interaction |

Proxy trust, distinct-client throttling and all remaining acceptance items below
remain pending. Initiating OAuth does not prove that Google accepts the client
or that its callback completes.

## Initial hosted execution record — 4 November 2026

Commit `3fe9a4f473a3d4a7002ff9f6afe95aa2c1154cdd`, Railway deployment
`7286448e-4a5b-46d6-83a9-719236016867`, image
`sha256:e96b606793c779de96ea756c7a4dbb066f3591e7bb136e2918bb28deb7a3b536`.
Programmatic HTTPS checks against `staging.lexi.fotiniv.com`:

| Check | Result |
| --- | --- |
| Container deployment | PASS: Railway SUCCESS |
| Frontend and database health | PASS: HTTP 200; database health `ok` |
| Session state before configuration | PASS: unauthenticated; auth unavailable |
| Protected profiles/vocabulary before configuration | PASS: fail closed with HTTP 503 |
| Real authentication, sessions, claims and isolation | NOT RUN: five provider variables absent in staging metadata |

No secret values were requested or logged. The entries below remain pending;
health checks do not establish provider or account-isolation acceptance.

## Real authentication and callback recovery

- [ ] Google registration creates one owned profile with learner role and no legacy/editor permissions. Password registration returns a generic acknowledgement without an identity/session; sign-in before email verification exposes no application profile, vocabulary, progress, collections, admin or claim data. After verification, sign-in provisions exactly one owned profile.
- [ ] Google denial, state mismatch, interrupted callbacks and a transient hydration failure recover safely without duplicate accounts/profiles; a pending `/claim` destination survives retries. Reused OAuth codes require fresh sign-in.
- [ ] Registration, sign-in and reset validate passwords appropriately. Check lower length boundaries, spaces, paste, password managers, current/new-password autofill and accessible show/hide controls with short synthetic passwords on development bcrypt. Record this limited result separately from full-policy acceptance.
- [ ] Production hashing gate: with the unchanged Unicode policy, confirm supported ARGON2 configuration and test 128/129-character boundaries, Unicode UTF-8 byte boundaries and rejection of a wrong password differing only beyond byte 72. Development bcrypt does not pass this gate; any bcrypt-compatible production policy requires a separately reviewed decision.
- [ ] Verification and reset mail arrives from the verified HTTPS sender with tracking disabled. Check inbox/spam, rejected recipient, quota exhaustion, timeout and provider outage. Generic acknowledgement is not evidence of delivery.
- [ ] Verification/reset links require explicit confirmation/submission, work once, and fail after configured expiry or reuse. Invalid/foreign tokens cannot change identity or password. URL parameters are cleared after submission and never logged or persisted. Test verification in another browser, without a session, and while a different account is signed in.
- [ ] Password sign-in fails generically for wrong credentials, missing identities and Google-only identities. Registration/recovery responses and cookies do not disclose existence, including duplicate registration and delivery outage. Rate limiting covers signup, signin, recovery, reset and verification, including public-tenant aliases.
- [ ] Google and password identities with the same email remain separate; their account IDs and learning data differ. Recovery for a Google-only email does not create a password account. Explicit linking flags are rejected. UI explains original-method recovery without exposing identity existence.
- [ ] Successful reset revokes existing sessions for that password identity; other users and a separate Google identity remain unaffected. Return to password sign-in after reset. Verify provider-required email status before protected access.
- [ ] Old passwordless code/create/resend/consume and email/phone existence endpoints return 404, including public aliases; old `/auth/verify` URLs cannot create sessions. Unreachable Core fails closed; logged-out direct APIs and old shared-gate sessions lack access.

## Historical pre-Tunnel investigation — 6 November 2026

Superseded for the active deployment by [Tunnel results](authentication-tunnel-staging-results.md).

See [exact inventory and result table](authentication-hosted-rate-limits.md).
Two independent external sources reached staging (PASS), but one produced 15
requests within 60 seconds with no 429 despite LOGIN_LIMIT=5 (FAIL). Separate
application buckets and spoof resistance are NOT VERIFIED; the private-path probe
is NOT RUN because operator SSH is unavailable. No forwarding-header trust was
weakened. The [Tunnel proposal](authentication-tunnel-proposal.md) includes bypass
closure, expected costs and rollback; it has not been provisioned.

## Runtime cause confirmed — 6 November 2026

The [deployed runtime trace](authentication-rate-limit-runtime-trace.md) verifies
29 source/startup files against `7ad3679`, effective limit 5 and window 60 seconds,
and actual counter updates for the exact GET probe. Seven identical public
requests used six anonymous buckets (FAIL). Stable private calls produced five
400s then two 429s (PASS for the counter, not public IP limiting). Private IPv4
reaches the same listener destination as public ingress; header trust remains
unchanged. The approved temporary SSH key and local key files were removed.
Do not repeat two-network/spoof bucket assertions until the public baseline passes.

## Sessions and request security

- [ ] Browser access/refresh credentials are HttpOnly, Secure and SameSite=Lax on HTTPS; no credentials or claim tokens in localStorage. Refresh access after expiry and confirm expected Core refresh window; revoke the session and verify the next protected request fails immediately.
- [ ] Logout revokes this session. Logout-all invalidates two browser sessions for the same provider subject, while an unrelated user's session remains valid.
- [ ] A foreign Origin and a missing session custom header cannot mutate authenticated protected data, including claim redemption. Pre-authentication claim capture requires the exact Origin and cannot change ownership; valid same-origin browser requests work. Attempt credentialed cross-origin calls from a disposable foreign origin.
- [ ] Auth initiation exceeding the configured rate returns throttling, resets after the window, and cannot be bypassed with forged forwarded headers. Verify two real clients are distinguished behind the trusted proxy.
- [ ] Edge/application logs, referrers, error reports and cache behavior disclose no auth/claim secrets; auth responses are not shared-cached. Use sanitised browser inspection rather than exporting HAR files with credentials.

## Two-user isolation and roles

- [ ] Learner A creates cards, units/tags, imports, collections, settings and reviews in both directions. Learner B cannot list, fetch, export, modify, archive, restore or practise A's records by guessed IDs, query parameters, CSV/bulk requests or collection references.
- [ ] A and B see published shared vocabulary. Restricted legacy content remains invisible without explicit access; collection membership and historical snapshots do not bypass visibility. Removing legacy access revokes access on the next request.
- [ ] Personal variants have new ownership and independent progress. Collection references do not copy cards or confer editing rights. Reject inaccessible/private foreign cards in collections and practice requests.
- [ ] Learners cannot assign roles, publish, or mutate shared content through UI or direct API. Admin assigns/revokes editor role; editor can manage permitted shared cards/units/tags/imports/bulk operations but cannot assign roles, publish or access A/B's private data. Revocation takes effect on the next protected request.
- [ ] CSV imports/exports and mixed bulk selections obey every item's permission; rejected requests leave no unauthorised partial changes. No foreign/private data leaks in counts, errors or exports.
- [ ] Authorised archive/restore preserves reviews, progress, completed sessions and snapshots. Archived cards stay out of future practice, including collection practice. Unauthorised archive/restore fails; inaccessible wording is redacted in history without losing review totals.
- [ ] Interface language uses local/browser selection before sign-in, saved account preference after sign-in, and current selection if initially unset. Other learning settings are account-owned; device accessibility stays local. No profile switching appears.

## Legacy claims and private recovery

- [ ] Admin-only issue/revoke/list controls reveal no profile directory to learners. Private recovery requests disclose no existence information to the requester; only authorised admins review them.
- [ ] Verify synthetic claimant identity manually. Issue bearer link, confirm fragment disappears immediately and login continuation survives sign-in without token leakage to provider redirects, localStorage or logs. Preview/GET/cancel never claims.
- [ ] Explicit redemption into an empty account preserves the legacy profile ID, all history and current account preferences/roles. It grants no legacy-library/editor/admin permissions; former empty profile remains retained.
- [ ] Expired, revoked, regenerated and already consumed links fail without ownership change, including revocation/replacement committed while redemption waits on a database lock. Continuation expiry at 20 minutes requires reopening a still-valid original link. Test sign-in taking longer than this without losing data.
- [ ] Race two accounts against one link and two links against one account: exactly one eligible transaction succeeds, no duplicate owners or partial updates. Check database uniqueness and complete original history afterward.
- [ ] Attempt redemption after new reviews, sessions or owned cards/units/tags/collections exist. Both profiles, all data and link remain unchanged; one private pending conflict/report is created. No automatic merge, reassignment, retirement or review loss.
- [ ] Claimed legacy profiles cannot be transferred/reclaimed. Sanitised security events exist for issuance/revocation/redemption/conflicts/request resolution, with no bearer secrets.

## Release evidence

- [ ] Repeat [backup/restore and upgrade checks](authentication-migration-runbook.md) on synthetic legacy fixtures; compare IDs, counts, timestamps, snapshots and constraints. Record independent security review findings and closure of material findings.
- [ ] Record actual local test and GitHub CI outcomes for this exact commit. Mark inaccessible CI as NOT VERIFIED with its reason. Resolve failures before proposing promotion.
- [ ] Keep PR #63 draft; no merge, tag, deploy, real claims or production migrations are authorised by completing this checklist.

## Historical checks before the Tunnel cutover

The current results and user-approved admin-test deferral are in
[release status](authentication-release-status.md); the pending entries below
record what was outstanding before that cutover.

- [x] Local focused backend contracts/isolation: 53 passed on source `6711733`.
- [x] Local AuthGate/AccountAccess/AccountCard UI regressions: 43 passed.
- [ ] Hosted A/B private vocabulary test: accounts confirmed available; unique
  synthetic private-card search requested, awaiting actual result. This is only
  one isolation check and does not establish all direct-ID/export/write boundaries.
- [ ] Fresh managed-provider Google and delivered verification/reset checks on a
  future Tunnel image. Preserve earlier user-reported passes for the unchanged
  deployed image; do not relabel local mocks as new live-provider evidence.

Public signup stays blocked for release independently of progress on these checks.
The complete A/B/forged-header/no-bypass acceptance sequence, production threshold
recommendations, expected costs and fail-closed rollback are in the
[unprovisioned ingress proposal](authentication-tunnel-proposal.md).
