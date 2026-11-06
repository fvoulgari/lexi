# PR #63 release evidence — 6 November 2026

PR #63 remains draft. This record authorises no merge, deployment, production
migration, paid Core or extension of staging spending. Collections remain in #65.

## Independent review

Two independent read-only reviewers inspected the authentication branch through
`95c40349abf2db1f7715ad0347ff55f11bcae8e9` against documented standards and the
accepted specification, including the subsequent email/password requirements.
Neither established a new concrete authorization, account-isolation, legacy-claim,
migration or password-change defect. They did not execute tests or verify hosted
configuration. Non-blocking maintainability observations were repeated provider
argument adaptation and duplicated throttle helpers; no security-driven refactor
is required to close those observations.

## Observed and reported results

- Current source CI passed: [run 41915204237](https://github.com/fvoulgari/lexi/actions/runs/41915204237).
  Backend/frontend checks and image validation passed; production jobs were skipped.
  This is evidence for the reviewed head, not subsequent documentation commits.
- Frontend: 262 tests passed; lint and production build passed. Existing mock-handler
  warnings for account credentials and the large-bundle warning remain visible.
- Backend: 178 tests passed, one opt-in local-Core integration test skipped because
  no isolated Core was running for this invocation. Ruff passed. An initial sandboxed
  database connection attempt failed; the permitted rerun completed successfully.
- Disposable PostgreSQL 17.11: actual custom-format dump, restore into another new
  database, and upgrade from `b46c77a9d008` to `b46d77a9d009` passed. Existing card,
  profile, session and review IDs, timestamps and snapshots were preserved;
  uniqueness, ownership, role defaults and archival-history checks passed. Both
  created databases and the temporary dump were removed. This is not a production
  restore or reconciliation of writes made after a production cutover.
- User-reported staging PASS: verification email received and used; reset email
  received and used; reuse rejected with generic invalid/expired/used feedback.
  This does not establish expiry timing or cross-account token rejection.
- User-reported staging PASS: wrong current password rejected; successful change
  invalidated two browser sessions; old password rejected and new one accepted.
  Google sign-in succeeded and Google-only settings hid Change password.
  Browser/version was not recorded. These reports are distinct from independently
  observed browser tests.

## Outstanding promotion gates

1. Establish a supported Railway ingress trust boundary and test independent client
   throttling plus forged-header resistance. Current loopback-only Uvicorn trust
   cannot be called verified for Railway clients. Do not trust every proxy, infer
   trusted CIDRs from observed peers, or treat Host as proof of public ingress.
   Railway documents X-Real-IP for public ingress, but private ingress bypasses its
   sanitization: [public headers](https://docs.railway.com/networking/public-networking/specs-and-limits)
   and [provider clarification](https://station.railway.com/questions/need-authoritative-client-ip-proxy-tru-090eac86).
2. Verify supported Argon2 configuration and non-truncation on the intended managed
   production Core, with approved billing. Development bcrypt does not establish
   compatibility with the advertised Unicode policy. See
   [hashing requirements](authentication-hashing.md). No custom hashing in Lexi.
3. Complete hosted synthetic two-user isolation, role transitions, claim
   continuation/redemption/revocation/conflicts, refresh expiry and unrelated-user
   session isolation using the [staging checklist](authentication-staging-checklist.md).
   Local API regressions do not substitute for that deployment evidence.
4. Follow the [migration/rollback runbook](authentication-migration-runbook.md)
   against the selected deployment and verified backup. Keep post-cutover data for
   reconciliation; do not downgrade an upgraded live database or overwrite it.

Do not recommend marking ready until these gates are satisfied. No credentials,
claim tokens or private user data belong in evidence or the PR.

## Legacy-claim focused verification — 6 November 2026

17 backend claim tests passed against disposable PostgreSQL; 40 frontend tests
passed across AccountAccess, claim-capture and AuthGate. Ruff passed. These cover
explicit redemption, no privilege grant, preserved profile/history, revoked,
expired, regenerated and consumed links, private recovery requests, conflicts,
transaction rollback and concurrency including revocation while waiting for locks.
The added continuation regression captures while logged out, signs in, expires
only the continuation, verifies preview/redemption rejection without reassignment
or token consumption, then reopens the still-valid original link and redeems.
Provider authentication is replaced by the test fixture; this does not certify a
real Google/password sign-in redirect and continuation on hosted staging.

Next hosted step: use a staging administrator and a clearly synthetic unclaimed
legacy profile. Never issue a test link for a real person's profile. Keep the link
out of chat, screenshots and logs. Open it in a separate signed-out browser,
sign in with an empty synthetic learner, inspect preview before confirmation,
and verify successful association preserves the original profile ID/history and
grants neither editor/admin nor restricted-library access. Subsequent cases need
separate synthetic profiles/accounts for revocation and activity conflicts.

## Proxy boundary focused checks

Three new local PostgreSQL/Uvicorn regressions passed; Ruff passed. They prove
untrusted forwarding-header rotation does not bypass the current limiter,
explicitly trusted synthetic proxies distinguish clients, and an untrusted shared
proxy collapses them. The hosted gate stays open. See the
[provider constraints and proposed authenticated-origin boundary](authentication-proxy-verification.md).
No proxy trust or infrastructure configuration was weakened or changed.


## Hosted rate-limit follow-up

[Actual staging inventory and results](authentication-hosted-rate-limits.md):
15 inert auth-initiation requests from one external source within 60 seconds
returned 400 despite reported LOGIN_LIMIT=5 (FAIL). A mobile-data connection was
confirmed as a second source, but separate application buckets and spoof isolation
remain NOT VERIFIED. Private-path execution is blocked by absent operator SSH.

The candidate adds persistent HMAC identifier backoff for failed password results,
without lockout or new password storage. Full backend run: 190 passed, one opt-in
local-Core test skipped; Ruff/format passed. No candidate deployment occurred.
The [Tunnel proposal](authentication-tunnel-proposal.md) closes public and private
bypasses, specifies expected costs and rollback, and remains unprovisioned.


## Runtime diagnosis of the missing public 429

The [sanitized trace](authentication-rate-limit-runtime-trace.md) confirms deployed
source, effective LOGIN_LIMIT=5 and a 60-second window. Seven identical public
requests hit six buckets; the limiter uses changing proxy transport peers. Stable
private requests correctly hit the sixth-request 429 and persist counter 7. The
private IPv4 path is now verified reachable and shares the public listener's local
destination. No safe header-provenance fix has been deployed; public gate remains
FAIL. No two-source/spoof retest, Cloudflare change or production operation followed.
Approved temporary diagnostic access was fully removed after use.
