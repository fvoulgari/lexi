# Email/password launch verification — 4 November 2026

Launch scope supersedes the earlier magic-link login implementation. SuperTokens
owns passwords, hashing, email verification and password-reset tokens; Lexi's
application schema and migrations are unchanged. Google remains available with
account linking disabled. Legacy claims remain available with their existing
hash-only links, continuations, permissions and conflict handling.

## Implemented

- Password registration validates through the provider API/recipe and responds
  identically for new and duplicate addresses, without identity or session
  cookies. New accounts receive verification mail; delivery failures retain
  the same public acknowledgement and emit a sanitised operator event.
- Password sign-in uses the browser and backend SDKs. Verification is required
  before application-account provisioning and protected data access, including
  legacy claim preview/redemption. Unverified sessions can request verification
  and sign out through SDK endpoints without receiving application data.
- Recovery uses the SDK reset recipe. Unknown and Google-only addresses receive
  the same response; delivery outages do not reveal known addresses. Successful
  reset revokes that password identity's existing sessions. Matching Google and
  password emails never merge or confer access to the other account.
- Registration/reset enforce 15–128 characters, allowing Unicode, spaces and
  password-manager paste. Core must be configured with supported ARGON2 hashing
  before launch. Autofill uses username/current-password/new-password fields;
  password visibility buttons are accessible and do not submit forms.
- Resend HTTPS delivery replaces SMTP, using only `RESEND_API_KEY` and
  `EMAIL_FROM`. No Resend service, billing or Railway upgrade was activated.
- No passwordless recipe is registered. Code/create/resend/consume and existence
  paths return 404, including public aliases. The old frontend callback is inert
  and discards stale URL credentials. Claim links are unaffected.
- Throttling includes password, recovery and verification APIs, including public
  tenant and trailing-slash aliases. Auth responses are marked no-store.

## Executed checks

Implementation at `0a991fd`; final documentation-only commits do not change it.

| Check | Result |
| --- | --- |
| Full backend suite, disposable PostgreSQL 17.11, opt-in local Core enabled | 164 passed |
| Frontend unit/component tests, 19 files | 232 passed |
| Backend Ruff, frontend ESLint, frontend build, diff whitespace | Passed |
| Local Chromium PWA checks | Passed |
| Local Chromium mobile navigation at 320/390/760 px | Passed |
| Greek sign-in at 320/390/1280 px | No horizontal overflow or browser errors |

Warnings: Starlette/httpx test-client deprecation and Vite's bundle-size warning.
The first combined Core run exposed incomplete SDK singleton cleanup in the
new test harness; recipe-specific reset fixed it and the combined 164-test run
passed. An earlier frontend expectation still used the old Google helper
signature; it was updated and the full frontend suite passed.

The opt-in `backend/tests/test_password_core_integration.py` used a temporary,
loopback-only in-memory Core image pinned to
`sha256:c74eef1f69b78388d6a3b5af142c8338be7824e532fe6d9e778a932227151637`.
It captured email templates locally without contacting Resend or Google.
Synthetic Google identities were created through the provider SDK to test
identity collisions; this does not exercise Google's OAuth exchange.

The Core was configured with ARGON2 and two-second verification/reset lifetimes
for this disposable test only. The test exercised actual SDK/Core registration,
password validation, duplicate response/cookie parity, unverified access denial,
verification in a second browser session, verification-token reuse rejection,
password sign-in, same-email identity separation, Google-only recovery no-op,
reset-token reuse and expiry, two-session revocation, stable application profile
identity, rejection of a wrong long Unicode password differing after byte 72,
and logout. The ordinary suite skips this test unless `LEXI_TEST_CORE_URI` points
to an explicitly started local Core; remote Core hosts are rejected. Local test
credentials must never be used for hosted deployments.

## Standards review

Independent review at `1ab52dd`, closure review at `0a991fd`: zero documented
standards violations and zero material heuristic findings. A separate recovery
observation found that clearing a token URL on transient failure prevented a
retry. Fixed by clearing only definitive success/invalid-token responses;
network-failure-then-retry regressions pass. Reviewer confirmed closure.

## Spec review

Independent review found one P1: SDK trailing-slash aliases bypassed exact-path
throttling. Fixed by normalising the path before boundary checks, with regressions
including configured SDK middleware. Reviewer confirmed closure and no new
concrete findings. Both reviews were source reviews, not independent live test
runs. No review finding remains open.

## Unverified release gates

Real Google OAuth, managed Core configuration/billing, Resend sender verification
and delivery, hosted cookies/proxy behavior, live renewal/revocation and real
browser legacy continuation remain NOT RUN. The prior synthetic PostgreSQL
backup/restore rehearsal remains separate evidence; it was not repeated for
this authentication-method change and does not prove a production migration.

Complete [provider setup](authentication-setup.md) and the
[staging checklist](authentication-staging-checklist.md) before recommending PR
readiness. No merge, hosted provisioning, paid service or production deployment
was performed or authorised here.
